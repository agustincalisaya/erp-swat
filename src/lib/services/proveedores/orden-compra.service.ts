import "server-only";

/**
 * @module orden-compra.service
 * @description Capa de dominio de HU-H3 — Emisión y seguimiento de Orden de
 * Compra (spec_modulo_H.md §2.4, §2.5, §3.1).
 *
 * TODA la lógica de negocio del circuito de OC vive acá: el Route Handler
 * (`app/api/ordenes-compra/**`) y las Server Actions
 * (`app/(dashboard)/compras/ordenes/actions.ts`) son wrappers finos —
 * resuelven sesión + permiso granular, parsean el body con Zod, invocan una
 * función de este archivo y mapean el resultado/excepción al shape estándar
 * `{ data, error }` (spec §1, §2, "Convenciones generales"). Está prohibido
 * reimplementar cualquier regla de acá en esas capas.
 *
 * Reglas transversales aplicadas (spec §3.5, RULES.md §1/§2):
 *  - Ninguna función de este archivo invoca `prisma.*.delete()` / `deleteMany()`.
 *    `CANCELAR` es baja lógica (`is_active=false` + `deleted_*` + `estado=CANCELADA`).
 *  - Toda escritura multi-tabla corre dentro de un único `prisma.$transaction`.
 *  - Los eventos de dominio se emiten DESPUÉS del `COMMIT`, nunca dentro
 *    (spec §3.4, patrón fire-and-forget de Módulo D — deuda técnica conocida).
 */

import { Prisma } from "@prisma/client";
import type { EstadoOrdenCompra } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  AccionOrdenCompra,
  CambiarEstadoOrdenCompraInput,
  CrearOrdenCompraInput,
  EditarItemsOrdenCompraInput,
} from "@/lib/schemas/ordenes-compra.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Permisos granulares (spec §2.4 / §2.5) — un permiso independiente por acción,
// NO un único `ordenes_compra:administrar`. Punto de verdad compartido por el
// Route Handler y la Server Action.
// ──────────────────────────────────────────────────────────────────────────────

export const PERMISO_CREAR_ORDEN_COMPRA = "ordenes_compra:crear";

export const PERMISO_POR_ACCION_ORDEN_COMPRA: Record<AccionOrdenCompra, string> = {
  ENVIAR: "ordenes_compra:enviar",
  CONFIRMAR: "ordenes_compra:confirmar",
  CERRAR: "ordenes_compra:cerrar",
  CANCELAR: "ordenes_compra:cancelar",
};

// ──────────────────────────────────────────────────────────────────────────────
// Máquina de estados (spec §3.1). Cualquier transición no listada se rechaza
// con `409 TRANSICION_INVALIDA` desde acá — nunca se confía en el `default` del
// enum de Prisma como única defensa.
//
// Las transiciones CONFIRMADA → RECEPCION_PARCIAL → RECIBIDA_COMPLETA NO viven
// acá: las gobierna `recepcion.service.ts` (HU-H4, Emir) al registrar una
// Recepcion. `CERRAR` solo lee el estado `RECIBIDA_COMPLETA` que ese service deja.
// TODO: integración con HU-H4 (Emir) — contrato pendiente de acordar.
// ──────────────────────────────────────────────────────────────────────────────

interface ReglaTransicion {
  origenes: EstadoOrdenCompra[];
  destino: EstadoOrdenCompra;
}

const TRANSICIONES: Record<AccionOrdenCompra, ReglaTransicion> = {
  ENVIAR: { origenes: ["BORRADOR"], destino: "ENVIADA" },
  CONFIRMAR: { origenes: ["ENVIADA"], destino: "CONFIRMADA" },
  CERRAR: { origenes: ["RECIBIDA_COMPLETA"], destino: "CERRADA" },
  CANCELAR: { origenes: ["BORRADOR", "ENVIADA"], destino: "CANCELADA" },
};

// ──────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface OrdenCompraCreada {
  orden_compra_id: string;
  numero_orden: string;
  estado: "BORRADOR";
}

export interface OrdenCompraEstadoCambiado {
  orden_compra_id: string;
  numero_orden: string;
  estado_anterior: EstadoOrdenCompra;
  estado_nuevo: EstadoOrdenCompra;
}

// ──────────────────────────────────────────────────────────────────────────────
// Guarda reutilizable — bloqueo de edición de ítems (spec §2.5)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * spec §2.5: "el servicio rechaza con `409` cualquier intento de mutar ítems
 * de una orden en estado distinto de `BORRADOR`". El endpoint de edición de
 * ítems queda fuera del alcance de §2.4/§2.5, pero la regla se deja
 * implementada acá para que ese endpoint la consuma sin reescribirla.
 */
export function asegurarItemsEditables(
  estado: EstadoOrdenCompra,
  numeroOrden: string,
): void {
  if (estado !== "BORRADOR") {
    throw new ServiceError(
      "ORDEN_ITEMS_BLOQUEADOS",
      `Los ítems de la orden ${numeroOrden} están bloqueados para edición desde el estado ENVIADA (estado actual: ${estado})`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.4 — Emisión de Orden de Compra
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Genera un `numero_orden` server-side determinístico y único
 * (`OC-<año>-<secuencia 6 díg.>`, ej. `OC-2026-000842`). El cliente nunca lo
 * provee (spec §2.4). El `@unique` de schema es la defensa final: ante una
 * colisión por concurrencia (`P2002`) el llamador reintenta.
 */
async function generarNumeroOrden(tx: Prisma.TransactionClient): Promise<string> {
  const anio = new Date().getFullYear();
  const prefijo = `OC-${anio}-`;
  const emitidasEsteAnio = await tx.ordenCompra.count({
    where: { numero_orden: { startsWith: prefijo } },
  });
  return `${prefijo}${String(emitidasEsteAnio + 1).padStart(6, "0")}`;
}

/**
 * Precondiciones + resolución de precios de una OrdenCompra (Camino A, spec
 * §2.4 / §3.4). Punto único de verdad compartido por `crearOrdenCompra()` y
 * `editarItemsOrdenCompra()` — garantiza que la edición de ítems resuelve el
 * precio EXACTAMENTE igual que el alta: el cliente nunca lo envía.
 *
 * Valida, en este orden: proveedor HOMOLOGADO y activo · lista de precios
 * vigente publicada · variantes activas · todas con precio en la versión
 * vigente. Lanza `ServiceError` con el código correspondiente ante la primera
 * falla.
 */
async function resolverContextoPrecios(
  tx: Prisma.TransactionClient,
  proveedorId: string,
  skuIds: string[],
): Promise<{
  listaPrecioVersionId: string;
  precioPorSku: Map<string, Prisma.Decimal>;
}> {
  // 1. Precondición: proveedor HOMOLOGADO y activo.
  const proveedor = await tx.proveedor.findFirst({
    where: { id: proveedorId },
    select: { id: true, estado: true, is_active: true, deleted_at: true },
  });
  if (!proveedor) {
    throw new ServiceError(
      "PROVEEDOR_NO_ENCONTRADO",
      "El proveedor indicado no existe",
    );
  }
  if (
    proveedor.estado !== "HOMOLOGADO" ||
    !proveedor.is_active ||
    proveedor.deleted_at !== null
  ) {
    throw new ServiceError(
      "PROVEEDOR_NO_HOMOLOGADO",
      "Solo un proveedor HOMOLOGADO y activo puede recibir una nueva orden de compra",
    );
  }

  // 2. ListaPrecioVersion vigente: `publicada = true AND fecha_inicio_vigencia
  //    <= now()`, ordenada desc, take(1).
  const versionVigente = await tx.listaPrecioVersion.findFirst({
    where: {
      publicada: true,
      is_active: true,
      deleted_at: null,
      fecha_inicio_vigencia: { lte: new Date() },
      lista_precio: {
        proveedor_id: proveedorId,
        is_active: true,
        deleted_at: null,
      },
    },
    orderBy: { fecha_inicio_vigencia: "desc" },
    select: { id: true },
  });
  if (!versionVigente) {
    throw new ServiceError(
      "PROVEEDOR_SIN_LISTA_VIGENTE",
      "El proveedor no tiene una lista de precios vigente publicada; no es posible resolver los precios de la orden",
    );
  }

  // 3. Las variantes solicitadas deben estar activas.
  const variantesActivas = await tx.varianteSKU.findMany({
    where: {
      id: { in: skuIds },
      is_active: true,
      deleted_at: null,
      producto_maestro: { is_active: true, deleted_at: null },
    },
    select: { id: true },
  });
  const skuActivos = new Set(variantesActivas.map((v) => v.id));
  const skuInvalidos = skuIds.filter((id) => !skuActivos.has(id));
  if (skuInvalidos.length > 0) {
    throw new ServiceError(
      "SKU_INVALIDO",
      `Una o más variantes no existen o están inactivas: ${skuInvalidos.join(", ")}`,
    );
  }

  // 4. ...y tener precio en la lista vigente. El cliente NUNCA envía el precio:
  //    se congela acá el de la lista.
  const preciosVigentes = await tx.listaPrecioItem.findMany({
    where: {
      lista_precio_version_id: versionVigente.id,
      variante_sku_id: { in: skuIds },
      is_active: true,
      deleted_at: null,
    },
    select: { variante_sku_id: true, precio_unitario: true },
  });
  const precioPorSku = new Map(
    preciosVigentes.map((p) => [p.variante_sku_id, p.precio_unitario]),
  );
  const skuSinPrecio = skuIds.filter((id) => !precioPorSku.has(id));
  if (skuSinPrecio.length > 0) {
    throw new ServiceError(
      "SKU_SIN_PRECIO_VIGENTE",
      `No hay precio vigente para una o más variantes: ${skuSinPrecio.join(", ")}`,
    );
  }

  return { listaPrecioVersionId: versionVigente.id, precioPorSku };
}

export async function crearOrdenCompra(
  input: CrearOrdenCompraInput,
  usuarioId: string,
): Promise<OrdenCompraCreada> {
  // Rechazo temprano de SKUs repetidos en el mismo payload: la orden sería
  // ambigua (dos líneas para la misma variante). No es un chequeo contra
  // base, por eso vive acá y no en el schema Zod.
  const skuIds = input.items.map((item) => item.variante_sku_id);
  if (new Set(skuIds).size !== skuIds.length) {
    throw new ServiceError(
      "ITEMS_DUPLICADOS",
      "La orden no puede incluir la misma variante en más de un ítem",
    );
  }

  const MAX_INTENTOS_NUMERO_ORDEN = 3;
  for (let intento = 1; ; intento++) {
    try {
      const { orden, listaPrecioVersionId } = await prisma.$transaction(
        async (tx) => {
          // Precondiciones + precios (Camino A): proveedor HOMOLOGADO, lista
          // vigente, variantes activas con precio. Mismo punto de verdad que
          // usa la edición de ítems.
          const { listaPrecioVersionId, precioPorSku } =
            await resolverContextoPrecios(tx, input.proveedor_id, skuIds);

          // Alta transaccional: OrdenCompra (BORRADOR, default de schema) +
          // sus N OrdenCompraItem con el precio congelado.
          const numeroOrden = await generarNumeroOrden(tx);
          const creada = await tx.ordenCompra.create({
            data: {
              numero_orden: numeroOrden,
              proveedor_id: input.proveedor_id,
              estado: "BORRADOR",
              observaciones: input.observaciones,
              creada_por_id: usuarioId,
              items: {
                create: input.items.map((item) => ({
                  variante_sku_id: item.variante_sku_id,
                  cantidad_solicitada: item.cantidad_solicitada,
                  // `!`: el paso 4 garantiza que todo SKU tiene precio.
                  precio_unitario: precioPorSku.get(item.variante_sku_id)!,
                })),
              },
            },
            select: {
              id: true,
              numero_orden: true,
              proveedor_id: true,
              items: {
                select: {
                  variante_sku_id: true,
                  cantidad_solicitada: true,
                  precio_unitario: true,
                },
              },
            },
          });

          return { orden: creada, listaPrecioVersionId };
        },
      );

      // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256).
      domainEventBus.emit("orden_compra:creada", {
        orden_compra_id: orden.id,
        numero_orden: orden.numero_orden,
        proveedor_id: orden.proveedor_id,
        estado: "BORRADOR",
        creada_por_id: usuarioId,
        lista_precio_version_id: listaPrecioVersionId,
        items: orden.items.map((item) => ({
          variante_sku_id: item.variante_sku_id,
          cantidad_solicitada: item.cantidad_solicitada,
          precio_unitario: item.precio_unitario.toString(),
        })),
      });

      return {
        orden_compra_id: orden.id,
        numero_orden: orden.numero_orden,
        estado: "BORRADOR",
      };
    } catch (error) {
      // Colisión de `numero_orden` por dos altas concurrentes: reintentar con
      // una secuencia recalculada (máx. 3 intentos), luego propagar.
      const esColisionNumeroOrden =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (error.meta?.target as string[] | undefined)?.includes("numero_orden");
      if (esColisionNumeroOrden && intento < MAX_INTENTOS_NUMERO_ORDEN) {
        continue;
      }
      throw error;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// §2.5 — Transición de estado (ENVIAR / CONFIRMAR / CERRAR / CANCELAR)
// ──────────────────────────────────────────────────────────────────────────────

export async function cambiarEstadoOrdenCompra(
  ordenCompraId: string,
  input: CambiarEstadoOrdenCompraInput,
  usuarioId: string,
): Promise<OrdenCompraEstadoCambiado> {
  const regla = TRANSICIONES[input.accion];
  const ahora = new Date();

  const resultado = await prisma.$transaction(async (tx) => {
    // Lectura DENTRO de la transacción que hace el UPDATE (spec §3.1): evita
    // la carrera entre dos requests concurrentes sobre la misma orden.
    const orden = await tx.ordenCompra.findFirst({
      where: { id: ordenCompraId },
      select: {
        id: true,
        numero_orden: true,
        estado: true,
        is_active: true,
        deleted_at: true,
      },
    });
    if (!orden) {
      throw new ServiceError(
        "ORDEN_NO_ENCONTRADA",
        "La orden de compra indicada no existe",
      );
    }

    // Una orden ya cancelada (baja lógica) es un estado terminal: ninguna
    // transición sale de CANCELADA/CERRADA.
    if (!orden.is_active || orden.deleted_at !== null) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        `La orden ${orden.numero_orden} está cancelada; no admite más transiciones`,
      );
    }
    if (!regla.origenes.includes(orden.estado)) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        `No es posible ${input.accion} una orden en estado ${orden.estado}`,
      );
    }

    const data: Prisma.OrdenCompraUpdateManyMutationInput = {
      estado: regla.destino,
    };
    switch (input.accion) {
      case "ENVIAR":
        data.fecha_envio = ahora;
        break;
      case "CONFIRMAR":
        data.fecha_confirmacion = ahora;
        data.fecha_entrega_comprometida = input.fecha_entrega_comprometida;
        break;
      case "CERRAR":
        data.fecha_cierre = ahora;
        break;
      case "CANCELAR":
        // Baja lógica (spec §2.5) — NUNCA un DELETE. La fila permanece
        // consultable para la trazabilidad de la negociación.
        data.is_active = false;
        data.deleted_at = ahora;
        data.deleted_by = usuarioId;
        data.deletion_reason = input.deletion_reason;
        break;
    }

    // UPDATE condicionado al estado origen leído: si otra transacción lo
    // cambió en el interín, `count === 0` → 409 (spec §3.1).
    const cambio = await tx.ordenCompra.updateMany({
      where: {
        id: ordenCompraId,
        estado: orden.estado,
        is_active: true,
        deleted_at: null,
      },
      data,
    });
    if (cambio.count === 0) {
      throw new ServiceError(
        "TRANSICION_INVALIDA",
        "El estado de la orden cambió durante la operación; reintentá",
      );
    }

    return { numero_orden: orden.numero_orden, estado_anterior: orden.estado };
  });

  // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256).
  domainEventBus.emit("orden_compra:estado_cambiado", {
    orden_compra_id: ordenCompraId,
    numero_orden: resultado.numero_orden,
    estado_anterior: resultado.estado_anterior,
    estado_nuevo: regla.destino,
    accion: input.accion,
    cambiado_por: usuarioId,
    fecha_entrega_comprometida:
      input.accion === "CONFIRMAR"
        ? input.fecha_entrega_comprometida.toISOString()
        : null,
    deletion_reason: input.accion === "CANCELAR" ? input.deletion_reason : null,
  });

  return {
    orden_compra_id: ordenCompraId,
    numero_orden: resultado.numero_orden,
    estado_anterior: resultado.estado_anterior,
    estado_nuevo: regla.destino,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// CA2 (Backlog Sprint 2) — Edición de ítems de una orden en BORRADOR
// ──────────────────────────────────────────────────────────────────────────────

export interface OrdenCompraItemsEditados {
  orden_compra_id: string;
  numero_orden: string;
}

/**
 * Reemplaza el set de ítems de una orden **en estado BORRADOR** (agregar,
 * quitar, cambiar cantidad). Semántica de reemplazo total: `input.items` es
 * el conjunto que debe quedar.
 *
 * Reglas transversales aplicadas:
 *  - El precio se resuelve server-side vía `resolverContextoPrecios()` — el
 *    mismo punto de verdad que `crearOrdenCompra()`. El cliente NUNCA lo envía.
 *  - Los ítems quitados se dan de **baja lógica** (`is_active=false` +
 *    `deleted_*`), nunca `DELETE` físico.
 *  - Cualquier estado distinto de BORRADOR → `409 ORDEN_ITEMS_BLOQUEADOS`
 *    (regla ya existente `asegurarItemsEditables`, no se reescribe).
 *  - Evento de dominio post-COMMIT → `audit-log.listener.ts` (`UPDATE`).
 */
export async function editarItemsOrdenCompra(
  ordenCompraId: string,
  input: EditarItemsOrdenCompraInput,
  usuarioId: string,
): Promise<OrdenCompraItemsEditados> {
  const skuIds = input.items.map((it) => it.variante_sku_id);
  if (new Set(skuIds).size !== skuIds.length) {
    throw new ServiceError(
      "ITEMS_DUPLICADOS",
      "La orden no puede incluir la misma variante en más de un ítem",
    );
  }

  const ahora = new Date();

  const resultado = await prisma.$transaction(async (tx) => {
    const orden = await tx.ordenCompra.findFirst({
      where: { id: ordenCompraId },
      select: {
        id: true,
        numero_orden: true,
        estado: true,
        proveedor_id: true,
        is_active: true,
        deleted_at: true,
        items: {
          where: { is_active: true },
          select: {
            id: true,
            variante_sku_id: true,
            cantidad_solicitada: true,
            precio_unitario: true,
          },
        },
      },
    });
    if (!orden) {
      throw new ServiceError(
        "ORDEN_NO_ENCONTRADA",
        "La orden de compra indicada no existe",
      );
    }
    if (!orden.is_active || orden.deleted_at !== null) {
      throw new ServiceError(
        "ORDEN_ITEMS_BLOQUEADOS",
        `Los ítems de la orden ${orden.numero_orden} no se pueden editar: la orden está cancelada`,
      );
    }
    // Regla ya existente: solo BORRADOR admite edición de ítems (409).
    asegurarItemsEditables(orden.estado, orden.numero_orden);

    // Guarda de concurrencia (mismo criterio que las transiciones de estado):
    // si otra request movió la orden fuera de BORRADOR en el interín, abortar.
    const guarda = await tx.ordenCompra.updateMany({
      where: {
        id: orden.id,
        estado: "BORRADOR",
        is_active: true,
        deleted_at: null,
      },
      data: { updated_at: ahora },
    });
    if (guarda.count === 0) {
      throw new ServiceError(
        "ORDEN_ITEMS_BLOQUEADOS",
        `El estado de la orden ${orden.numero_orden} cambió durante la edición; recargá y reintentá`,
      );
    }

    // Precios resueltos EXACTAMENTE igual que al crear.
    const { listaPrecioVersionId, precioPorSku } = await resolverContextoPrecios(
      tx,
      orden.proveedor_id,
      skuIds,
    );

    const itemsActuales = new Map(
      orden.items.map((it) => [it.variante_sku_id, it]),
    );
    const skuPayload = new Set(skuIds);

    // Quitados → baja lógica (NUNCA delete físico).
    const quitados = orden.items.filter(
      (it) => !skuPayload.has(it.variante_sku_id),
    );
    if (quitados.length > 0) {
      await tx.ordenCompraItem.updateMany({
        where: { id: { in: quitados.map((it) => it.id) } },
        data: {
          is_active: false,
          deleted_at: ahora,
          deleted_by: usuarioId,
          deletion_reason:
            "Ítem quitado de la orden durante la edición en estado BORRADOR",
        },
      });
    }

    // Nuevos + actualizados. El precio se re-congela contra la lista vigente
    // en cada guardado (spec §3.4: no-retroactividad al emitir, pero mientras
    // es BORRADOR la orden todavía no se emitió).
    for (const item of input.items) {
      const actual = itemsActuales.get(item.variante_sku_id);
      const precio = precioPorSku.get(item.variante_sku_id)!;
      if (actual) {
        await tx.ordenCompraItem.update({
          where: { id: actual.id },
          data: {
            cantidad_solicitada: item.cantidad_solicitada,
            precio_unitario: precio,
          },
        });
      } else {
        await tx.ordenCompraItem.create({
          data: {
            orden_compra_id: orden.id,
            variante_sku_id: item.variante_sku_id,
            cantidad_solicitada: item.cantidad_solicitada,
            precio_unitario: precio,
          },
        });
      }
    }

    return {
      numeroOrden: orden.numero_orden,
      listaPrecioVersionId,
      itemsAnteriores: orden.items.map((it) => ({
        variante_sku_id: it.variante_sku_id,
        cantidad_solicitada: it.cantidad_solicitada,
        precio_unitario: it.precio_unitario.toString(),
      })),
      itemsNuevos: input.items.map((it) => ({
        variante_sku_id: it.variante_sku_id,
        cantidad_solicitada: it.cantidad_solicitada,
        precio_unitario: precioPorSku.get(it.variante_sku_id)!.toString(),
      })),
    };
  });

  // Post-COMMIT: evento de dominio → Módulo D (auditoría SHA-256).
  domainEventBus.emit("orden_compra:items_editados", {
    orden_compra_id: ordenCompraId,
    numero_orden: resultado.numeroOrden,
    editada_por: usuarioId,
    lista_precio_version_id: resultado.listaPrecioVersionId,
    items_anteriores: resultado.itemsAnteriores,
    items_nuevos: resultado.itemsNuevos,
  });

  return {
    orden_compra_id: ordenCompraId,
    numero_orden: resultado.numeroOrden,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lecturas para la UI (listado / detalle / selectores del formulario de alta).
//
// Solo lectura: no aplican reglas de negocio, resuelven proyecciones para las
// pantallas de `app/(dashboard)/compras/ordenes/**`. Las páginas son React
// Server Components y llaman a estas funciones directamente (sin fetch HTTP),
// igual que el resto del dashboard (`/inventario/*`, `/auditoria/*`).
// ──────────────────────────────────────────────────────────────────────────────

export interface FiltrosListadoOrdenesCompra {
  estado?: EstadoOrdenCompra;
  proveedor_id?: string;
}

/**
 * CA3 (Backlog Sprint 2): "el sistema alerta ante incumplimiento de la fecha
 * de entrega comprometida". Alerta **calculada al leer** (decisión del
 * equipo): sin persistencia ni cron. Una orden está vencida si tiene fecha
 * comprometida, ese día ya pasó, y todavía no se recibió toda la mercadería
 * (estados CONFIRMADA / RECEPCION_PARCIAL — RECIBIDA_COMPLETA y CERRADA ya
 * cumplieron; BORRADOR/ENVIADA aún no tienen fecha; CANCELADA es terminal).
 *
 * `fecha_entrega_comprometida` se persiste como fecha-solo (medianoche UTC);
 * se compara contra el inicio del día de hoy en UTC para que el propio día
 * de entrega no cuente como vencido.
 */
export function estaEntregaVencida(
  fechaEntregaComprometida: Date | null,
  estado: EstadoOrdenCompra,
): boolean {
  if (!fechaEntregaComprometida) return false;
  if (estado !== "CONFIRMADA" && estado !== "RECEPCION_PARCIAL") return false;
  const inicioDeHoyUTC = new Date();
  inicioDeHoyUTC.setUTCHours(0, 0, 0, 0);
  return new Date(fechaEntregaComprometida) < inicioDeHoyUTC;
}

export interface OrdenCompraResumen {
  id: string;
  numero_orden: string;
  proveedor_id: string;
  proveedor_razon_social: string;
  estado: EstadoOrdenCompra;
  fecha_emision: Date;
  cantidad_items: number;
  total: number;
  /** CA3 — true si la fecha de entrega comprometida ya venció sin recepción completa. */
  entrega_vencida: boolean;
}

/**
 * Listado de órdenes de compra para `/compras/ordenes`. NO filtra por
 * `is_active`: una orden CANCELADA (baja lógica) sigue siendo parte del
 * historial y debe verse en la grilla con su badge de estado (spec §2.4,
 * Alcance §2.4 — la baja lógica preserva la fila para trazabilidad).
 */
export async function listarOrdenesCompra(
  filtros: FiltrosListadoOrdenesCompra = {},
): Promise<OrdenCompraResumen[]> {
  const where: Prisma.OrdenCompraWhereInput = {};
  if (filtros.estado) where.estado = filtros.estado;
  if (filtros.proveedor_id) where.proveedor_id = filtros.proveedor_id;

  const ordenes = await prisma.ordenCompra.findMany({
    where,
    orderBy: { fecha_emision: "desc" },
    select: {
      id: true,
      numero_orden: true,
      proveedor_id: true,
      estado: true,
      fecha_emision: true,
      fecha_entrega_comprometida: true,
      proveedor: { select: { razon_social: true } },
      items: {
        where: { is_active: true },
        select: { cantidad_solicitada: true, precio_unitario: true },
      },
    },
  });

  return ordenes.map((oc) => ({
    id: oc.id,
    numero_orden: oc.numero_orden,
    proveedor_id: oc.proveedor_id,
    proveedor_razon_social: oc.proveedor.razon_social,
    estado: oc.estado,
    fecha_emision: oc.fecha_emision,
    cantidad_items: oc.items.length,
    total: oc.items.reduce(
      (acc, it) => acc + it.cantidad_solicitada * it.precio_unitario.toNumber(),
      0,
    ),
    entrega_vencida: estaEntregaVencida(oc.fecha_entrega_comprometida, oc.estado),
  }));
}

export interface ProveedorParaSelector {
  id: string;
  razon_social: string;
  nombre_fantasia: string | null;
}

/**
 * Proveedores seleccionables en el formulario de alta de OC. El filtro
 * `estado = HOMOLOGADO` se aplica en el query (no solo visualmente): la UI no
 * debe ofrecer un proveedor que el servicio va a rechazar con
 * `422 PROVEEDOR_NO_HOMOLOGADO` (spec §2.4).
 */
export async function listarProveedoresHomologados(): Promise<ProveedorParaSelector[]> {
  return prisma.proveedor.findMany({
    where: { estado: "HOMOLOGADO", is_active: true, deleted_at: null },
    orderBy: { razon_social: "asc" },
    select: { id: true, razon_social: true, nombre_fantasia: true },
  });
}

export interface VarianteParaSelector {
  id: string;
  sku: string;
  descripcion: string;
}

/**
 * Tope defensivo del selector de variantes del formulario de alta. El
 * `ComboboxFiltrable` filtra client-side sobre la lista ya cargada; este
 * límite evita mandar el catálogo entero al cliente si crece. Suficiente
 * para el alcance de HU-H3 (paginación server-side del selector queda como
 * mejora futura si el catálogo lo requiere).
 */
const MAX_VARIANTES_SELECTOR = 500;

export async function listarVariantesParaOrden(): Promise<VarianteParaSelector[]> {
  const variantes = await prisma.varianteSKU.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      producto_maestro: { is_active: true, deleted_at: null },
    },
    orderBy: { sku: "asc" },
    take: MAX_VARIANTES_SELECTOR,
    select: {
      id: true,
      sku: true,
      talle: true,
      color: true,
      modelo: true,
      producto_maestro: { select: { nombre: true } },
    },
  });

  return variantes.map((v) => ({
    id: v.id,
    sku: v.sku,
    descripcion: `${v.producto_maestro.nombre} · ${v.modelo} · ${v.talle}/${v.color}`,
  }));
}

export interface OrdenCompraItemDetalle {
  id: string;
  variante_sku_id: string;
  sku: string;
  descripcion: string;
  cantidad_solicitada: number;
  precio_unitario: number;
  subtotal: number;
}

export interface OrdenCompraDetalle {
  id: string;
  numero_orden: string;
  proveedor_id: string;
  proveedor_razon_social: string;
  proveedor_nombre_fantasia: string | null;
  estado: EstadoOrdenCompra;
  fecha_emision: Date;
  fecha_envio: Date | null;
  fecha_confirmacion: Date | null;
  fecha_entrega_comprometida: Date | null;
  fecha_cierre: Date | null;
  observaciones: string | null;
  creada_por_nombre: string | null;
  is_active: boolean;
  deleted_at: Date | null;
  deletion_reason: string | null;
  items: OrdenCompraItemDetalle[];
  total: number;
  /** CA3 — true si la fecha de entrega comprometida ya venció sin recepción completa. */
  entrega_vencida: boolean;
}

/** Detalle completo de una OC para `/compras/ordenes/[id]`. `null` si no existe. */
export async function obtenerOrdenCompra(
  id: string,
): Promise<OrdenCompraDetalle | null> {
  const oc = await prisma.ordenCompra.findFirst({
    where: { id },
    select: {
      id: true,
      numero_orden: true,
      proveedor_id: true,
      estado: true,
      fecha_emision: true,
      fecha_envio: true,
      fecha_confirmacion: true,
      fecha_entrega_comprometida: true,
      fecha_cierre: true,
      observaciones: true,
      creada_por_id: true,
      is_active: true,
      deleted_at: true,
      deletion_reason: true,
      proveedor: { select: { razon_social: true, nombre_fantasia: true } },
      items: {
        where: { is_active: true },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          variante_sku_id: true,
          cantidad_solicitada: true,
          precio_unitario: true,
          variante_sku: {
            select: {
              sku: true,
              talle: true,
              color: true,
              modelo: true,
              producto_maestro: { select: { nombre: true } },
            },
          },
        },
      },
    },
  });
  if (!oc) return null;

  const creador = await prisma.usuario.findFirst({
    where: { id: oc.creada_por_id },
    select: { nombre_completo: true },
  });

  const items: OrdenCompraItemDetalle[] = oc.items.map((it) => {
    const precio = it.precio_unitario.toNumber();
    return {
      id: it.id,
      variante_sku_id: it.variante_sku_id,
      sku: it.variante_sku.sku,
      descripcion: `${it.variante_sku.producto_maestro.nombre} · ${it.variante_sku.modelo} · ${it.variante_sku.talle}/${it.variante_sku.color}`,
      cantidad_solicitada: it.cantidad_solicitada,
      precio_unitario: precio,
      subtotal: precio * it.cantidad_solicitada,
    };
  });

  return {
    id: oc.id,
    numero_orden: oc.numero_orden,
    proveedor_id: oc.proveedor_id,
    proveedor_razon_social: oc.proveedor.razon_social,
    proveedor_nombre_fantasia: oc.proveedor.nombre_fantasia,
    estado: oc.estado,
    fecha_emision: oc.fecha_emision,
    fecha_envio: oc.fecha_envio,
    fecha_confirmacion: oc.fecha_confirmacion,
    fecha_entrega_comprometida: oc.fecha_entrega_comprometida,
    fecha_cierre: oc.fecha_cierre,
    observaciones: oc.observaciones,
    creada_por_nombre: creador?.nombre_completo ?? null,
    is_active: oc.is_active,
    deleted_at: oc.deleted_at,
    deletion_reason: oc.deletion_reason,
    items,
    total: items.reduce((acc, it) => acc + it.subtotal, 0),
    entrega_vencida: estaEntregaVencida(
      oc.fecha_entrega_comprometida,
      oc.estado,
    ),
  };
}

export interface MovimientoHistorialOrdenCompra {
  id: string;
  accion: string;
  fecha: Date;
  usuario_nombre: string | null;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  detalle: string | null;
}

/**
 * Línea de tiempo de cambios de estado de una OC, leída del ledger de
 * auditoría (Módulo D). Incluye:
 *  - `orden_compra:creada` / `orden_compra:estado_cambiado` (H3) —
 *    `tabla_afectada: "ordenes_compra"`, `registro_id` = id de la OC.
 *  - `recepcion:registrada` (HU-H4) — `tabla_afectada: "recepciones"`,
 *    `registro_id` = id de la Recepcion. Aporta las transiciones
 *    CONFIRMADA → RECEPCION_PARCIAL → RECIBIDA_COMPLETA, que las gobierna
 *    `recepcion.service.ts` y sin las cuales el seguimiento saltaba de
 *    CONFIRMADA directo a CERRADA (CA1: "seguimiento hasta el cierre").
 *
 * Solo lectura, no verifica la cadena SHA-256 (eso es responsabilidad de la
 * consola de auditoría, no de esta pantalla).
 */
export async function obtenerHistorialOrdenCompra(
  ordenCompraId: string,
): Promise<MovimientoHistorialOrdenCompra[]> {
  // Las filas de recepción se auditan con `registro_id` = id de la Recepcion
  // (no de la OC), así que hay que resolver primero qué recepciones tiene la
  // orden para sumarlas al filtro del ledger.
  const recepcionIds = (
    await prisma.recepcion.findMany({
      where: { orden_compra_id: ordenCompraId },
      select: { id: true },
    })
  ).map((r) => r.id);

  const registros = await prisma.auditLog.findMany({
    where: {
      OR: [
        { tabla_afectada: "ordenes_compra", registro_id: ordenCompraId },
        { tabla_afectada: "recepciones", registro_id: { in: recepcionIds } },
      ],
    },
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      accion: true,
      tabla_afectada: true,
      created_at: true,
      usuario_id: true,
      valor_anterior: true,
      valor_nuevo: true,
    },
  });

  const userIds = [
    ...new Set(
      registros
        .map((r) => r.usuario_id)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const usuarios = userIds.length
    ? await prisma.usuario.findMany({
        where: { id: { in: userIds } },
        select: { id: true, nombre_completo: true },
      })
    : [];
  const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre_completo]));

  return registros.map((r) => {
    // Las filas de `recepciones` (HU-H4) guardan el estado de la OC en
    // `estado_orden_compra`, no en `estado` como las de `ordenes_compra`.
    const esRecepcion = r.tabla_afectada === "recepciones";

    const anterior = (r.valor_anterior ?? null) as unknown as
      | { estado?: string; estado_orden_compra?: string }
      | null;
    const nuevo = (r.valor_nuevo ?? null) as unknown as
      | {
          estado?: string;
          estado_orden_compra?: string;
          accion?: string;
          deletion_reason?: string;
          fecha_entrega_comprometida?: string;
        }
      | null;

    const estadoAnterior = esRecepcion
      ? (anterior?.estado_orden_compra ?? null)
      : (anterior?.estado ?? null);
    const estadoNuevo = esRecepcion
      ? (nuevo?.estado_orden_compra ?? null)
      : (nuevo?.estado ?? null);

    let detalle: string | null = null;
    if (esRecepcion) {
      detalle = "Recepción de mercadería registrada";
    } else if (nuevo?.deletion_reason) {
      detalle = `Motivo: ${nuevo.deletion_reason}`;
    } else if (nuevo?.fecha_entrega_comprometida) {
      // `timeZone: "UTC"` — es una fecha-solo persistida como medianoche UTC;
      // sin fijar la TZ se mostraría un día antes en UTC-3.
      detalle = `Entrega comprometida: ${new Date(
        nuevo.fecha_entrega_comprometida,
      ).toLocaleDateString("es-AR", { timeZone: "UTC" })}`;
    }

    return {
      id: r.id,
      accion: r.accion,
      fecha: r.created_at,
      usuario_nombre: r.usuario_id
        ? (nombrePorId.get(r.usuario_id) ?? null)
        : null,
      estado_anterior: estadoAnterior,
      estado_nuevo: estadoNuevo,
      detalle,
    };
  });
}
