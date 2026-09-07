/**
 * HU-A9 — Servicio de Reclasificación de unidades DEVUELTO
 * (spec_modulo_A.md §2.8/§3.5/§3.8/§4).
 *
 * Cierra la transición `Devuelto` de la máquina de estados de stock
 * (Alcance §2.2): reincorporar unidades aptas (`APTO` → `DISPONIBLE`) o
 * darlas de baja por rotura/obsolescencia (`NO_APTO` → `BAJA_MERMA` con
 * motivo obligatorio). Doble validación por umbral: bajo o igual a
 * `UMBRAL_BAJA_MERMA_UNIDADES` persiste directo; sobre el umbral crea SOLO
 * una `ReclasificacionSolicitud` en `PENDIENTE_APROBACION` (sin tocar
 * stock) que un Administrador debe aprobar o rechazar.
 *
 * Patrón obligatorio (spec §3.4): toda escritura multi-tabla vive dentro de
 * `prisma.$transaction`; los eventos se emiten SIEMPRE post-COMMIT, nunca
 * dentro de la transacción (regla de emisión, spec §4). El service NUNCA
 * escribe `AuditLog` — el listener del Módulo D lo hace tras cada evento.
 *
 * Append-only: este flujo inserta `MovimientoStock`/`MovimientoStockItem`
 * compensatorios (`tipo_movimiento = "AJUSTE"`), nunca reescribe movimientos
 * previos (inmutabilidad contable, spec §3.2).
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { superaUmbral } from "@/lib/config/reclasificacion.config";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  ListarUnidadesDevueltasQuery,
  ReclasificarDevueltoInput,
} from "@/lib/schemas/inventario.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de resultado
// ──────────────────────────────────────────────────────────────────────────────

/** Resultado de una reclasificación aplicada de forma directa (bajo umbral). */
export interface ReclasificacionDirectaResultado {
  movimiento_id: string;
  estado_destino: "DISPONIBLE" | "BAJA_MERMA";
  /** Presente SOLO cuando `estado_destino = "DISPONIBLE"` (stock reincorporado). */
  stock_resultante?: { deposito_id: string; cantidad: number };
}

/** Resultado de una reclasificación sobre el umbral: solicitud pendiente. */
export interface ReclasificacionSolicitudResultado {
  solicitud_id: string;
  estado: "PENDIENTE_APROBACION";
}

export type ReclasificarDevueltoResultado =
  | ReclasificacionDirectaResultado
  | ReclasificacionSolicitudResultado;

/** Resultado de la aprobación de una solicitud (siempre BAJA_MERMA). */
export interface SolicitudAprobadaResultado {
  solicitud_id: string;
  estado: "APROBADA";
  movimiento_id: string;
  estado_destino: "BAJA_MERMA";
}

export interface SolicitudRechazadaResultado {
  solicitud_id: string;
  estado: "RECHAZADA";
}

/** Fila del listado de unidades devueltas (`listarUnidadesDevueltas`). */
export interface UnidadDevueltaListado {
  id: string;
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  deposito_id: string | null;
  cantidad: number;
  estado_origen: string | null;
  motivo: string | null;
  rma_id: string | null;
  created_at: Date;
}

/** Fila del listado de solicitudes pendientes (`listarSolicitudesPendientes`). */
export interface SolicitudReclasificacionListado {
  id: string;
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  deposito_id: string;
  deposito_nombre: string;
  cantidad: number;
  motivo: string | null;
  rma_id: string | null;
  solicitada_por_id: string;
  created_at: Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Resultado interno de la transacción (para decidir la emisión post-COMMIT)
// ──────────────────────────────────────────────────────────────────────────────

type ResultadoReclasificacionTx =
  | {
      via: "DIRECTO";
      movimiento_id: string;
      estado_destino: "DISPONIBLE" | "BAJA_MERMA";
      stock_resultante?: { deposito_id: string; cantidad: number };
    }
  | { via: "SOLICITUD"; solicitud_id: string };

/**
 * Reclasifica una unidad en estado `DEVUELTO` (spec_modulo_A.md §2.8).
 *
 * 1. Valida que la variante y el depósito existan y estén activos (404).
 * 2. Precondición de estado: el último `MovimientoStockItem` del par
 *    `(variante_sku_id, deposito_id)` debe tener `estado_destino = "DEVUELTO"`
 *    (resuelto por `created_at` desc — no existe estado desnormalizado en
 *    `StockDeposito`). Si no → `ESTADO_INVALIDO_PARA_RECLASIFICACION` (409).
 * 3. Según `superaUmbral(cantidad)`:
 *    - Bajo/igual al umbral: inserta `MovimientoStock` `AJUSTE` + item
 *      (`estado_origen = "DEVUELTO"`, `estado_destino` según resultado) y,
 *      solo si `APTO`, incrementa `StockDeposito.cantidad`. Emite
 *      `stock:reclasificacion_devuelto` post-COMMIT.
 *    - Sobre el umbral: crea SOLO `ReclasificacionSolicitud`
 *      `PENDIENTE_APROBACION` (sin movimiento ni stock). Emite
 *      `stock:reclasificacion_solicitud_creada` post-COMMIT.
 *
 * Defensa en profundidad: `NO_APTO` sin `motivo` → `MOTIVO_REQUERIDO` (400),
 * misma regla de la sección 3.5 — el `superRefine` del schema ya lo
 * rechaza, esta re-validación cubre llamadores que lo salteen.
 *
 * @throws {ServiceError} MOTIVO_REQUERIDO (400) | VARIANTE_NO_ENCONTRADA /
 *   DEPOSITO_NO_ENCONTRADO / STOCK_DEPOSITO_NO_ENCONTRADO (404) |
 *   ESTADO_INVALIDO_PARA_RECLASIFICACION (409)
 */
export async function reclasificarDevuelto(
  input: ReclasificarDevueltoInput,
  usuarioId: string,
): Promise<ReclasificarDevueltoResultado> {
  if (input.resultado_control_calidad === "NO_APTO" && !input.motivo) {
    throw new ServiceError("MOTIVO_REQUERIDO", "El motivo es obligatorio cuando el resultado es NO_APTO");
  }

  const estadoDestino = input.resultado_control_calidad === "APTO" ? "DISPONIBLE" : "BAJA_MERMA";

  const resultado = await prisma.$transaction(
    async (tx: Prisma.TransactionClient): Promise<ResultadoReclasificacionTx> => {
      const [variante, deposito] = await Promise.all([
        tx.varianteSKU.findFirst({
          where: { id: input.variante_sku_id, is_active: true, deleted_at: null },
          select: { id: true },
        }),
        tx.deposito.findFirst({
          where: { id: input.deposito_id, is_active: true, deleted_at: null },
          select: { id: true },
        }),
      ]);

      if (!variante) throw new ServiceError("VARIANTE_NO_ENCONTRADA", "La variante no existe o está inactiva");
      if (!deposito) throw new ServiceError("DEPOSITO_NO_ENCONTRADO", "El depósito no existe o está inactivo");

      // Precondición de estado (spec §2.8): la unidad debe estar DEVUELTO en
      // su último movimiento para el par (variante, depósito). Se resuelve el
      // ÚLTIMO item del par sin filtrar por estado (orderBy ANIDADO por
      // created_at desc — no hay estado desnormalizado) y se valida su
      // estado_destino post-query: filtrar `estado_destino` en el where
      // permitiría reclasificar un par cuyo último movimiento global ya no
      // es DEVUELTO (doble reclasificación o "resurrección" de BAJA_MERMA).
      const ultimoItem = await tx.movimientoStockItem.findFirst({
        where: {
          variante_sku_id: input.variante_sku_id,
          is_active: true,
          movimiento: {
            deposito_destino_id: input.deposito_id,
            is_active: true,
          },
        },
        orderBy: { movimiento: { created_at: "desc" } },
        select: { id: true, estado_destino: true },
      });
      if (!ultimoItem || ultimoItem.estado_destino !== "DEVUELTO") {
        throw new ServiceError(
          "ESTADO_INVALIDO_PARA_RECLASIFICACION",
          "La unidad no se encuentra en estado 'Devuelto'",
        );
      }

      if (!superaUmbral(input.cantidad)) {
        // ── Vía directa (bajo umbral): hecho consumado ──────────────────────
        const movimiento = await tx.movimientoStock.create({
          data: {
            deposito_destino_id: input.deposito_id,
            tipo_movimiento: "AJUSTE",
            comprobante_referencia: null,
            registrado_por_id: usuarioId,
            items: {
              create: {
                variante_sku_id: input.variante_sku_id,
                cantidad: input.cantidad,
                estado_origen: "DEVUELTO",
                estado_destino: estadoDestino,
                motivo: input.motivo ?? null,
                rma_id: input.rma_id ?? null,
              },
            },
          },
          select: { id: true },
        });

        let stockResultante: { deposito_id: string; cantidad: number } | undefined;
        if (estadoDestino === "DISPONIBLE") {
          // Solo APTO reincorpora stock comercial (spec §2.8): NO_APTO deja
          // StockDeposito intacto — la unidad pasa a BAJA_MERMA.
          const incremento = await tx.stockDeposito.updateMany({
            where: {
              variante_sku_id: input.variante_sku_id,
              deposito_id: input.deposito_id,
              is_active: true,
              deleted_at: null,
            },
            data: { cantidad: { increment: input.cantidad } },
          });
          if (incremento.count === 0) {
            throw new ServiceError(
              "STOCK_DEPOSITO_NO_ENCONTRADO",
              "No existe stock cargado para la variante en el depósito indicado",
            );
          }
          const stock = await tx.stockDeposito.findFirst({
            where: {
              variante_sku_id: input.variante_sku_id,
              deposito_id: input.deposito_id,
              is_active: true,
              deleted_at: null,
            },
            select: { cantidad: true },
          });
          if (!stock) {
            throw new ServiceError(
              "STOCK_DEPOSITO_NO_ENCONTRADO",
              "No existe stock cargado para la variante en el depósito indicado",
            );
          }
          stockResultante = { deposito_id: input.deposito_id, cantidad: stock.cantidad };
        }

        return { via: "DIRECTO", movimiento_id: movimiento.id, estado_destino: estadoDestino, stock_resultante: stockResultante };
      }

      // ── Vía solicitud (sobre umbral): pendiente de aprobación Admin ──────
      const solicitud = await tx.reclasificacionSolicitud.create({
        data: {
          variante_sku_id: input.variante_sku_id,
          deposito_id: input.deposito_id,
          cantidad: input.cantidad,
          motivo: input.motivo ?? null,
          rma_id: input.rma_id ?? null,
          estado: "PENDIENTE_APROBACION",
          solicitada_por_id: usuarioId,
        },
        select: { id: true },
      });
      return { via: "SOLICITUD", solicitud_id: solicitud.id };
    },
  );

  // Regla de emisión (spec §4): SIEMPRE post-COMMIT, nunca dentro de $transaction.
  if (resultado.via === "DIRECTO") {
    domainEventBus.emit("stock:reclasificacion_devuelto", {
      movimiento_id: resultado.movimiento_id,
      variante_sku_id: input.variante_sku_id,
      deposito_id: input.deposito_id,
      resultado_control_calidad: input.resultado_control_calidad,
      estado_origen: "DEVUELTO",
      estado_destino: resultado.estado_destino,
      motivo: input.motivo ?? undefined,
      rma_id: input.rma_id,
      usuario_id: usuarioId,
    });
    return {
      movimiento_id: resultado.movimiento_id,
      estado_destino: resultado.estado_destino,
      stock_resultante: resultado.stock_resultante,
    };
  }

  domainEventBus.emit("stock:reclasificacion_solicitud_creada", {
    solicitud_id: resultado.solicitud_id,
    variante_sku_id: input.variante_sku_id,
    deposito_id: input.deposito_id,
    cantidad: input.cantidad,
    motivo: input.motivo ?? undefined,
    rma_id: input.rma_id,
    usuario_id: usuarioId,
  });
  return { solicitud_id: resultado.solicitud_id, estado: "PENDIENTE_APROBACION" };
}

/**
 * Aprueba una `ReclasificacionSolicitud` pendiente (spec_modulo_A.md §3.8,
 * permiso exclusivo `inventario:reclasificar_aprobar`).
 *
 * Las solicitudes SOLO nacen de un control de calidad NO_APTO sobre el
 * umbral, por lo que la aprobación siempre aplica el movimiento compensatorio
 * con `estado_destino = "BAJA_MERMA"` (nunca incrementa `StockDeposito`).
 * El `updateMany` condicionado por `estado: "PENDIENTE_APROBACION"` cierra la
 * ventana de carrera contra una doble aprobación/rechazo concurrente.
 *
 * Post-COMMIT emite `stock:reclasificacion_solicitud_aprobada` y
 * `stock:reclasificacion_devuelto` (el listener de auditoría registra contra
 * ambas tablas).
 *
 * @throws {ServiceError} SOLICITUD_NO_ENCONTRADA (404) | SOLICITUD_NO_PENDIENTE (422)
 */
export async function aprobarSolicitud(
  solicitudId: string,
  adminId: string,
): Promise<SolicitudAprobadaResultado> {
  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const solicitud = await tx.reclasificacionSolicitud.findFirst({
      where: { id: solicitudId, is_active: true, deleted_at: null },
      select: {
        id: true,
        variante_sku_id: true,
        deposito_id: true,
        cantidad: true,
        motivo: true,
        rma_id: true,
      },
    });
    if (!solicitud) throw new ServiceError("SOLICITUD_NO_ENCONTRADA", "La solicitud no existe");

    const cierre = await tx.reclasificacionSolicitud.updateMany({
      where: { id: solicitudId, estado: "PENDIENTE_APROBACION", is_active: true, deleted_at: null },
      data: { estado: "APROBADA", aprobada_por_id: adminId, aprobada_at: new Date() },
    });
    if (cierre.count === 0) {
      throw new ServiceError("SOLICITUD_NO_PENDIENTE", "La solicitud ya fue aprobada o rechazada");
    }

    const movimiento = await tx.movimientoStock.create({
      data: {
        deposito_destino_id: solicitud.deposito_id,
        tipo_movimiento: "AJUSTE",
        comprobante_referencia: `RECLASIFICACION-SOLICITUD-${solicitud.id}`,
        registrado_por_id: adminId,
        items: {
          create: {
            variante_sku_id: solicitud.variante_sku_id,
            cantidad: solicitud.cantidad,
            estado_origen: "DEVUELTO",
            estado_destino: "BAJA_MERMA",
            motivo: solicitud.motivo ?? null,
            rma_id: solicitud.rma_id ?? null,
          },
        },
      },
      select: { id: true },
    });

    return {
      movimiento_id: movimiento.id,
      variante_sku_id: solicitud.variante_sku_id,
      deposito_id: solicitud.deposito_id,
      motivo: solicitud.motivo,
      rma_id: solicitud.rma_id,
    };
  });

  domainEventBus.emit("stock:reclasificacion_solicitud_aprobada", {
    solicitud_id: solicitudId,
    movimiento_id: resultado.movimiento_id,
    variante_sku_id: resultado.variante_sku_id,
    estado_destino: "BAJA_MERMA",
    admin_id: adminId,
  });
  domainEventBus.emit("stock:reclasificacion_devuelto", {
    movimiento_id: resultado.movimiento_id,
    variante_sku_id: resultado.variante_sku_id,
    deposito_id: resultado.deposito_id,
    resultado_control_calidad: "NO_APTO",
    estado_origen: "DEVUELTO",
    estado_destino: "BAJA_MERMA",
    motivo: resultado.motivo ?? undefined,
    rma_id: resultado.rma_id ?? undefined,
    usuario_id: adminId,
  });

  return {
    solicitud_id: solicitudId,
    estado: "APROBADA",
    movimiento_id: resultado.movimiento_id,
    estado_destino: "BAJA_MERMA",
  };
}

/**
 * Rechaza una `ReclasificacionSolicitud` pendiente con motivo obligatorio
 * (spec_modulo_A.md §3.8). Sin movimiento ni impacto de stock. Post-COMMIT
 * emite `stock:reclasificacion_solicitud_rechazada`.
 *
 * @throws {ServiceError} SOLICITUD_RECHAZADA_MOTIVO_REQUERIDO (400) |
 *   SOLICITUD_NO_ENCONTRADA (404) | SOLICITUD_NO_PENDIENTE (422)
 */
export async function rechazarSolicitud(
  solicitudId: string,
  adminId: string,
  rechazadaMotivo: string,
): Promise<SolicitudRechazadaResultado> {
  if (!rechazadaMotivo || rechazadaMotivo.trim() === "") {
    throw new ServiceError("SOLICITUD_RECHAZADA_MOTIVO_REQUERIDO", "El motivo de rechazo es obligatorio");
  }

  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const solicitud = await tx.reclasificacionSolicitud.findFirst({
      where: { id: solicitudId, is_active: true, deleted_at: null },
      select: { id: true, variante_sku_id: true },
    });
    if (!solicitud) throw new ServiceError("SOLICITUD_NO_ENCONTRADA", "La solicitud no existe");

    const cierre = await tx.reclasificacionSolicitud.updateMany({
      where: { id: solicitudId, estado: "PENDIENTE_APROBACION", is_active: true, deleted_at: null },
      data: { estado: "RECHAZADA", rechazada_motivo: rechazadaMotivo },
    });
    if (cierre.count === 0) {
      throw new ServiceError("SOLICITUD_NO_PENDIENTE", "La solicitud ya fue aprobada o rechazada");
    }

    return { variante_sku_id: solicitud.variante_sku_id };
  });

  domainEventBus.emit("stock:reclasificacion_solicitud_rechazada", {
    solicitud_id: solicitudId,
    variante_sku_id: resultado.variante_sku_id,
    rechazada_motivo: rechazadaMotivo,
    admin_id: adminId,
  });

  return { solicitud_id: solicitudId, estado: "RECHAZADA" };
}

/**
 * Lista las solicitudes de reclasificación en `PENDIENTE_APROBACION`
 * (sección de aprobación Admin, spec §3.8). Devuelve variante y depósito
 * resueltos para mostrar la fila sin joins en el cliente.
 */
export async function listarSolicitudesPendientes(): Promise<SolicitudReclasificacionListado[]> {
  const solicitudes = await prisma.reclasificacionSolicitud.findMany({
    where: { estado: "PENDIENTE_APROBACION", is_active: true, deleted_at: null },
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      variante_sku_id: true,
      deposito_id: true,
      cantidad: true,
      motivo: true,
      rma_id: true,
      solicitada_por_id: true,
      created_at: true,
      variante_sku: {
        select: { sku: true, producto_maestro: { select: { nombre: true } } },
      },
      deposito: { select: { nombre: true } },
    },
  });

  return solicitudes.map((solicitud) => ({
    id: solicitud.id,
    variante_sku_id: solicitud.variante_sku_id,
    sku: solicitud.variante_sku.sku,
    producto_nombre: solicitud.variante_sku.producto_maestro.nombre,
    deposito_id: solicitud.deposito_id,
    deposito_nombre: solicitud.deposito.nombre,
    cantidad: solicitud.cantidad,
    motivo: solicitud.motivo,
    rma_id: solicitud.rma_id,
    solicitada_por_id: solicitud.solicitada_por_id,
    created_at: solicitud.created_at,
  }));
}

/**
 * Lista las unidades ACTUALMENTE en estado `DEVUELTO` (filtros opcionales de
 * variante y depósito, sin paginación). Solo se listan los pares
 * `(variante_sku_id, deposito_id)` cuyo ÚLTIMO movimiento item es `DEVUELTO`
 * (resuelto por `created_at` desc, consistente con la precondición de
 * `reclasificarDevuelto`): un item DEVUELTO antiguo bajo un movimiento
 * `BAJA_MERMA`/`DISPONIBLE` posterior NO se lista. Se excluyen además los
 * pares con una `ReclasificacionSolicitud` en `PENDIENTE_APROBACION` (la
 * unidad queda "en trámite" hasta el veredicto del Admin). El depósito se
 * resuelve desde la cabecera del movimiento (no existe estado desnormalizado
 * en `StockDeposito`). Nunca expone datos sensibles.
 */
export async function listarUnidadesDevueltas(
  filtros: ListarUnidadesDevueltasQuery = {},
): Promise<UnidadDevueltaListado[]> {
  const where: Prisma.MovimientoStockItemWhereInput = {
    estado_destino: "DEVUELTO",
    is_active: true,
    deleted_at: null,
    movimiento: {
      is_active: true,
      deleted_at: null,
      ...(filtros.deposito_id ? { deposito_destino_id: filtros.deposito_id } : {}),
    },
    ...(filtros.variante_sku_id ? { variante_sku_id: filtros.variante_sku_id } : {}),
  };

  const candidatos = await prisma.movimientoStockItem.findMany({
    where,
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      variante_sku_id: true,
      cantidad: true,
      estado_origen: true,
      motivo: true,
      rma_id: true,
      created_at: true,
      variante_sku: {
        select: { sku: true, producto_maestro: { select: { nombre: true } } },
      },
      movimiento: { select: { deposito_destino_id: true } },
    },
  });

  const variantesIds = [...new Set(candidatos.map((item) => item.variante_sku_id))];
  const depositosIds = [
    ...new Set(
      candidatos
        .map((item) => item.movimiento?.deposito_destino_id)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  ];

  // Último item por par (variante, depósito) SIN filtrar por estado: si el
  // último movimiento del par ya no es DEVUELTO (reclasificado directo o
  // solicitud aprobada → BAJA_MERMA/DISPONIBLE), el item DEVUELTO original
  // no debe listarse (precondición consistente con `reclasificarDevuelto`).
  const ultimosItems = await prisma.movimientoStockItem.findMany({
    where: {
      variante_sku_id: { in: variantesIds },
      is_active: true,
      deleted_at: null,
      movimiento: {
        deposito_destino_id: { in: depositosIds },
        is_active: true,
        deleted_at: null,
      },
    },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      variante_sku_id: true,
      movimiento: { select: { deposito_destino_id: true } },
    },
  });

  const ultimoItemPorPar = new Map<string, string>();
  for (const item of ultimosItems) {
    const deposito_id = item.movimiento?.deposito_destino_id ?? null;
    if (deposito_id === null) continue;
    const clave = `${item.variante_sku_id}:${deposito_id}`;
    if (!ultimoItemPorPar.has(clave)) {
      ultimoItemPorPar.set(clave, item.id);
    }
  }

  // Pares con una solicitud pendiente de aprobación: se excluyen del listado.
  const solicitudesPendientes = await prisma.reclasificacionSolicitud.findMany({
    where: { estado: "PENDIENTE_APROBACION", is_active: true, deleted_at: null },
    select: { variante_sku_id: true, deposito_id: true },
  });
  const paresConSolicitudPendiente = new Set(
    solicitudesPendientes.map((solicitud) => `${solicitud.variante_sku_id}:${solicitud.deposito_id}`),
  );

  const unidades: UnidadDevueltaListado[] = [];
  for (const item of candidatos) {
    const deposito_id = item.movimiento?.deposito_destino_id ?? null;
    if (deposito_id === null) continue;
    const clave = `${item.variante_sku_id}:${deposito_id}`;
    if (ultimoItemPorPar.get(clave) !== item.id) continue;
    if (paresConSolicitudPendiente.has(clave)) continue;
    unidades.push({
      id: item.id,
      variante_sku_id: item.variante_sku_id,
      sku: item.variante_sku.sku,
      producto_nombre: item.variante_sku.producto_maestro.nombre,
      deposito_id,
      cantidad: item.cantidad,
      estado_origen: item.estado_origen,
      motivo: item.motivo,
      rma_id: item.rma_id,
      created_at: item.created_at,
    });
  }

  return unidades;
}