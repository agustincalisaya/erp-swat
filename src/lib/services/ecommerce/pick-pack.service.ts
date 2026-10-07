import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type {
  DomainEventMap,
  EcommercePedidoListoParaRetiroPayload,
  EcommercePedidoTomadoPayload,
  EcommercePrioridadPreparacionCambiadaPayload,
  EcommerceUnidadPreparacionConfirmadaPayload,
} from "@/lib/events/event-types";
import { sumarDiasCalendarioNegocio } from "@/lib/utils/fecha-negocio";
import type {
  ColaPreparacionQuery,
  ConfirmarItemPreparacionInput,
} from "@/lib/schemas/pick-pack.schema";
import type {
  AdmisionResultado,
  ColaPreparacionItemDto,
  LineaPreparacionDto,
  PaginacionColaPreparacionDto,
  PrioridadResultado,
  ProgresoPreparacionDto,
  ResultadoCompletarPreparacion,
  ResultadoConfirmarItem,
  ResultadoTomarPedido,
  VariantePreparacionDto,
} from "@/lib/services/ecommerce/pick-pack.types";

// ──────────────────────────────────────────────────────────────────────────────
// Emisión post-COMMIT segura
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Publica un evento de dominio después de que la transacción ya hizo commit.
 * Si un listener síncrono lanza, la excepción se captura y se loguea, pero
 * NO se propaga al servicio que emitió, porque la operación de dominio ya
 * está confirmada. El bus es in-process y no durable; este helper no agrega
 * outbox ni reentrega automática.
 */
function emitirEventoPostCommitSeguro<K extends keyof DomainEventMap>(
  eventName: K,
  payload: DomainEventMap[K],
  contexto: { pedido_venta_id: string },
): void {
  try {
    domainEventBus.emit(eventName, payload);
  } catch (error) {
    console.error(`[HU-E12] Falló la publicación post-commit de ${String(eventName)}:`, {
      pedido_venta_id: contexto.pedido_venta_id,
      error: error instanceof Error ? error.message : "error desconocido",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tipos internos
// ──────────────────────────────────────────────────────────────────────────────

interface AgregadoPickPackBloqueado {
  pedido_venta_id: string;
  canal: string;
  pv_is_active: boolean;
  pv_deleted_at: Date | null;
  pve_id: string;
  estado_ecommerce: string;
  operador_asignado_id: string | null;
  prioridad_manual: number | null;
  pve_is_active: boolean;
  pve_deleted_at: Date | null;
  fecha_pago_confirmado: Date | null;
  codigo_qr_retiro: string | null;
  plazo_retiro_vencimiento: Date | null;
}

interface PedidoVentaBloqueado {
  id: string;
  canal: string;
  is_active: boolean;
  deleted_at: Date | null;
}

interface ExtensionEcommerceBloqueada {
  id: string;
  pedido_venta_id: string;
  estado_ecommerce: string;
  operador_asignado_id: string | null;
  prioridad_manual: number | null;
  fecha_pago_confirmado: Date | null;
  codigo_qr_retiro: string | null;
  plazo_retiro_vencimiento: Date | null;
  is_active: boolean;
  deleted_at: Date | null;
}

interface ItemConEscaneos {
  pedido_venta_item_id: string;
  pedido_venta_id: string;
  cantidad: number;
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  talle: string | null;
  color: string | null;
  modelo: string | null;
  confirmados: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Bloqueo del agregado (orden estable: PedidoVenta → PedidoVentaEcommerce)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Orden de adquisición de locks del agregado Pick&Pack:
 * 1. PedidoVenta (por id)
 * 2. PedidoVentaEcommerce (por pedido_venta_id)
 *
 * Futuras mutaciones (T05/T06/E13) deben respetar esta jerarquía y, al
 * bloquear ítems, hacerlo sobre PedidoVentaItem ordenadamente, por ejemplo:
 * ORDER BY created_at ASC, id ASC FOR UPDATE.
 */

/**
 * Bloquea la fila de `PedidoVenta` por id con `FOR UPDATE`.
 * Retorna `null` si no existe o está inactiva/borrada.
 */
async function bloquearPedidoVentaPickPack(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
): Promise<PedidoVentaBloqueado | null> {
  const rows = await tx.$queryRaw<PedidoVentaBloqueado[]>`
    SELECT id, canal, is_active, deleted_at
    FROM pedidos_venta
    WHERE id = ${pedidoVentaId}
      AND is_active = true
      AND deleted_at IS NULL
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Bloquea la fila de `PedidoVentaEcommerce` por `pedido_venta_id` con
 * `FOR UPDATE`. Retorna `null` si no existe o está inactiva/borrada.
 */
async function bloquearExtensionEcommercePickPack(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
): Promise<ExtensionEcommerceBloqueada | null> {
  const rows = await tx.$queryRaw<ExtensionEcommerceBloqueada[]>`
    SELECT
      id,
      pedido_venta_id,
      estado_ecommerce,
      operador_asignado_id,
      prioridad_manual,
      fecha_pago_confirmado,
      codigo_qr_retiro,
      plazo_retiro_vencimiento,
      is_active,
      deleted_at
    FROM pedidos_venta_ecommerce
    WHERE pedido_venta_id = ${pedidoVentaId}
      AND is_active = true
      AND deleted_at IS NULL
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Adquiere los locks del agregado en orden estricto y retorna el snapshot
 * necesario para la lógica de dominio. Retorna `null` si falta alguna parte
 * activa del agregado.
 */
async function bloquearAgregadoPickPack(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
): Promise<AgregadoPickPackBloqueado | null> {
  const pedido = await bloquearPedidoVentaPickPack(tx, pedidoVentaId);
  if (!pedido) return null;

  const extension = await bloquearExtensionEcommercePickPack(tx, pedidoVentaId);
  if (!extension) return null;

  return {
    pedido_venta_id: pedido.id,
    canal: pedido.canal,
    pv_is_active: pedido.is_active,
    pv_deleted_at: pedido.deleted_at,
    pve_id: extension.id,
    estado_ecommerce: extension.estado_ecommerce,
    operador_asignado_id: extension.operador_asignado_id,
    prioridad_manual: extension.prioridad_manual,
    pve_is_active: extension.is_active,
    pve_deleted_at: extension.deleted_at,
    fecha_pago_confirmado: extension.fecha_pago_confirmado,
    codigo_qr_retiro: extension.codigo_qr_retiro,
    plazo_retiro_vencimiento: extension.plazo_retiro_vencimiento,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de escaneo (T05)
// ──────────────────────────────────────────────────────────────────────────────

interface ItemPedidoBloqueado {
  id: string;
  pedido_venta_id: string;
  variante_sku_id: string;
  cantidad: number;
  sku: string;
  producto_nombre: string;
  talle: string | null;
  color: string | null;
  modelo: string | null;
}

/**
 * Resuelve un código escaneado (EAN-13 / QR serializado como SKU) contra el
 * catálogo activo usando el mismo `TransactionClient` para mantener atomicidad.
 */
async function resolverCodigoEscaneoTx(
  tx: Prisma.TransactionClient,
  codigo: string,
): Promise<{
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  talle: string | null;
  color: string | null;
  modelo: string | null;
} | null> {
  const variante = await tx.varianteSKU.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
      OR: [{ ean_qr: codigo }, { sku: codigo }],
    },
    include: {
      producto_maestro: { select: { nombre: true } },
    },
  });

  if (!variante) return null;

  return {
    variante_sku_id: variante.id,
    sku: variante.sku,
    producto_nombre: variante.producto_maestro.nombre,
    talle: variante.talle,
    color: variante.color,
    modelo: variante.modelo,
  };
}

/**
 * Bloquea todos los ítems activos de un pedido con `FOR UPDATE`, ordenados
 * determinísticamente. El orden estable previene deadlocks con T05/T06/E13.
 */
async function bloquearItemsPedidoPickPack(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
): Promise<ItemPedidoBloqueado[]> {
  return await tx.$queryRaw<ItemPedidoBloqueado[]>`
    SELECT
      pvi.id,
      pvi.pedido_venta_id,
      pvi.variante_sku_id,
      pvi.cantidad,
      vs.sku,
      pm.nombre AS producto_nombre,
      vs.talle,
      vs.color,
      vs.modelo
    FROM pedido_venta_items pvi
    JOIN variantes_sku vs ON vs.id = pvi.variante_sku_id
    JOIN productos_maestros pm ON pm.id = vs.producto_maestro_id
    WHERE pvi.pedido_venta_id = ${pedidoVentaId}
      AND pvi.is_active = true
      AND pvi.deleted_at IS NULL
    ORDER BY pvi.created_at ASC, pvi.id ASC
    FOR UPDATE
  `;
}

/**
 * Cuenta los escaneos activos por ítem para un conjunto de líneas.
 */
async function contarEscaneosPorItem(
  tx: Prisma.TransactionClient,
  itemIds: string[],
): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const agrupados = await tx.pedidoPreparacionEscaneo.groupBy({
    by: ["pedido_venta_item_id"],
    where: {
      pedido_venta_item_id: { in: itemIds },
      is_active: true,
      deleted_at: null,
    },
    _count: { _all: true },
  });
  return new Map(agrupados.map((g) => [g.pedido_venta_item_id, g._count._all]));
}

/**
 * Reconstruye el progreso global del pedido a partir de los escaneos activos.
 */
async function calcularProgresoPedido(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
): Promise<ProgresoPreparacionDto> {
  const items = await tx.pedidoVentaItem.findMany({
    where: {
      pedido_venta_id: pedidoVentaId,
      is_active: true,
      deleted_at: null,
    },
    select: { id: true, cantidad: true },
  });
  const confirmados = await contarEscaneosPorItem(
    tx,
    items.map((i) => i.id),
  );
  return calcularProgreso(
    items.map((i) => ({
      cantidad_requerida: i.cantidad,
      cantidad_confirmada: confirmados.get(i.id) ?? 0,
    })),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Admisión E2 → E12
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Admite un pedido WEB pagado a la cola de preparación. Debe ejecutarse dentro
 * del mismo `Prisma.TransactionClient` que confirma el pago (HU-E2).
 *
 * Idempotente cuando el pedido ya está en `EN_PREPARACION`.
 *
 * @throws {ServiceError} PEDIDO_NO_OPERABLE (404)
 * @throws {ServiceError} PEDIDO_SIN_FECHA_PAGO (409)
 * @throws {ServiceError} PEDIDO_NO_ADMITIBLE (409)
 */
export async function admitirPedidoPagoConfirmado(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
): Promise<AdmisionResultado> {
  const agregado = await bloquearAgregadoPickPack(tx, pedidoVentaId);
  if (!agregado) {
    throw new ServiceError(
      "PEDIDO_NO_OPERABLE",
      "El pedido no existe, no es operable o no tiene extensión de e-commerce activa",
    );
  }

  if (agregado.canal !== "WEB") {
    throw new ServiceError("PEDIDO_NO_OPERABLE", "La admisión solo aplica a pedidos del canal WEB");
  }

  if (agregado.estado_ecommerce === "EN_PREPARACION") {
    return { pedido_venta_id: pedidoVentaId, transicion_realizada: false };
  }

  if (agregado.fecha_pago_confirmado === null) {
    throw new ServiceError(
      "PEDIDO_SIN_FECHA_PAGO",
      "No se puede admitir un pedido sin fecha real de confirmación de pago",
    );
  }

  if (agregado.estado_ecommerce !== "PAGO_CONFIRMADO") {
    throw new ServiceError(
      "PEDIDO_NO_ADMITIBLE",
      `El pedido ya no está en PAGO_CONFIRMADO (estado actual: ${agregado.estado_ecommerce})`,
    );
  }

  await tx.pedidoVentaEcommerce.update({
    where: { id: agregado.pve_id },
    data: { estado_ecommerce: "EN_PREPARACION" },
  });

  const resultado: AdmisionResultado = {
    pedido_venta_id: pedidoVentaId,
    transicion_realizada: true,
    evento_pendiente: {
      tipo: "ecommerce:pedido_admitido_cola",
      payload: {
        evento_id: crypto.randomUUID(),
        pedido_venta_id: pedidoVentaId,
        pedido_venta_ecommerce_id: agregado.pve_id,
        actor_id: null,
        estado_nuevo: "EN_PREPARACION",
        timestamp: new Date().toISOString(),
      },
    },
  };

  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// Cálculo de progreso
// ──────────────────────────────────────────────────────────────────────────────

export function calcularProgreso(
  lineas: Array<{ cantidad_requerida: number; cantidad_confirmada: number }>,
): ProgresoPreparacionDto {
  const totalRequerido = lineas.reduce((acc, l) => acc + l.cantidad_requerida, 0);
  const totalConfirmado = lineas.reduce((acc, l) => acc + Math.min(l.cantidad_confirmada, l.cantidad_requerida), 0);
  const porcentaje = totalRequerido === 0 ? 0 : Math.round((totalConfirmado / totalRequerido) * 100);
  return {
    total_requerido: totalRequerido,
    total_confirmado: totalConfirmado,
    porcentaje,
    completo: totalRequerido > 0 && totalConfirmado === totalRequerido,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Listar cola de preparación
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Lista paginada de pedidos WEB en `EN_PREPARACION`.
 *
 * Orden contractual:
 * 1. `prioridad_manual DESC NULLS LAST`
 * 2. `fecha_pago_confirmado ASC NULLS LAST`
 * 3. `PedidoVenta.id ASC`
 */
export async function listarColaPreparacion(
  filtros: ColaPreparacionQuery,
): Promise<PaginacionColaPreparacionDto> {
  const { page, page_size } = filtros;
  const skip = (page - 1) * page_size;

  const [total, idsRows] = await Promise.all([
    prisma.pedidoVentaEcommerce.count({
      where: {
        estado_ecommerce: "EN_PREPARACION",
        is_active: true,
        deleted_at: null,
        pedido_venta: {
          canal: "WEB",
          is_active: true,
          deleted_at: null,
        },
      },
    }),
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT pve.id
      FROM pedidos_venta_ecommerce pve
      JOIN pedidos_venta pv ON pv.id = pve.pedido_venta_id
      WHERE pv.canal = 'WEB'
        AND pv.is_active = true
        AND pv.deleted_at IS NULL
        AND pve.is_active = true
        AND pve.deleted_at IS NULL
        AND pve.estado_ecommerce = 'EN_PREPARACION'::"EstadoEcommerce"
      ORDER BY
        pve.prioridad_manual DESC NULLS LAST,
        pve.fecha_pago_confirmado ASC NULLS LAST,
        pv.id ASC
      LIMIT ${page_size} OFFSET ${skip}
    `,
  ]);

  const ids = idsRows.map((r) => r.id);
  if (ids.length === 0) {
    return { items: [], total, page, page_size };
  }

  const pedidos = await prisma.pedidoVentaEcommerce.findMany({
    where: { id: { in: ids } },
    include: {
      pedido_venta: {
        select: { id: true, numero_venta: true },
      },
      operador_asignado: {
        select: { id: true, nombre_completo: true },
      },
    },
  });

  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
  const pedidosOrdenados = ids
    .map((id) => pedidoPorId.get(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  const pedidoIds = pedidosOrdenados.map((p) => p.pedido_venta_id);
  const itemsRaw = await prisma.pedidoVentaItem.findMany({
    where: {
      pedido_venta_id: { in: pedidoIds },
      is_active: true,
      deleted_at: null,
    },
    include: {
      variante_sku: {
        include: {
          producto_maestro: { select: { nombre: true } },
        },
      },
    },
    orderBy: { created_at: "asc" },
  });

  const itemIds = itemsRaw.map((i) => i.id);
  const escaneosAgrupados = await prisma.pedidoPreparacionEscaneo.groupBy({
    by: ["pedido_venta_item_id"],
    where: {
      pedido_venta_item_id: { in: itemIds },
      is_active: true,
      deleted_at: null,
    },
    _count: { _all: true },
  });
  const confirmadosPorItem = new Map(
    escaneosAgrupados.map((g) => [g.pedido_venta_item_id, g._count._all]),
  );

  const itemsPorPedido = new Map<string, ItemConEscaneos[]>();
  for (const item of itemsRaw) {
    const entry: ItemConEscaneos = {
      pedido_venta_item_id: item.id,
      pedido_venta_id: item.pedido_venta_id,
      cantidad: item.cantidad,
      variante_sku_id: item.variante_sku_id,
      sku: item.variante_sku.sku,
      producto_nombre: item.variante_sku.producto_maestro.nombre,
      talle: item.variante_sku.talle,
      color: item.variante_sku.color,
      modelo: item.variante_sku.modelo,
      confirmados: confirmadosPorItem.get(item.id) ?? 0,
    };
    const lista = itemsPorPedido.get(item.pedido_venta_id) ?? [];
    lista.push(entry);
    itemsPorPedido.set(item.pedido_venta_id, lista);
  }

  const items: ColaPreparacionItemDto[] = pedidosOrdenados.map((pve) => {
    const lineasRaw = itemsPorPedido.get(pve.pedido_venta_id) ?? [];
    const lineas: LineaPreparacionDto[] = lineasRaw.map((l) => ({
      pedido_venta_item_id: l.pedido_venta_item_id,
      variante: {
        variante_sku_id: l.variante_sku_id,
        sku: l.sku,
        producto_nombre: l.producto_nombre,
        talle: l.talle,
        color: l.color,
        modelo: l.modelo,
      } satisfies VariantePreparacionDto,
      cantidad_requerida: l.cantidad,
      cantidad_confirmada: l.confirmados,
      completa: l.confirmados >= l.cantidad,
    }));
    return {
      pedido_venta_id: pve.pedido_venta_id,
      pedido_venta_ecommerce_id: pve.id,
      numero_venta: pve.pedido_venta.numero_venta,
      fecha_pago_confirmado: pve.fecha_pago_confirmado,
      prioridad_manual: pve.prioridad_manual,
      estado_ecommerce: pve.estado_ecommerce,
      operador_asignado_id: pve.operador_asignado_id,
      lineas,
      progreso: calcularProgreso(lineas),
    };
  });

  return { items, total, page, page_size };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tomar pedido
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Asigna un pedido `EN_PREPARACION` al operador indicado.
 *
 * @throws {ServiceError} PEDIDO_NO_OPERABLE (404)
 * @throws {ServiceError} PEDIDO_YA_TOMADO (409)
 * @throws {ServiceError} ESTADO_INVALIDO (409)
 */
export async function tomarPedido(
  pedidoVentaId: string,
  actorId: string,
): Promise<ResultadoTomarPedido> {
  const resultado = await prisma.$transaction(async (tx) => {
    const agregado = await bloquearAgregadoPickPack(tx, pedidoVentaId);
    if (!agregado) {
      throw new ServiceError(
        "PEDIDO_NO_OPERABLE",
        "El pedido no existe, no es operable o no tiene extensión de e-commerce activa",
      );
    }

    if (agregado.canal !== "WEB") {
      throw new ServiceError("PEDIDO_NO_OPERABLE", "La operación solo aplica a pedidos del canal WEB");
    }

    if (agregado.estado_ecommerce !== "EN_PREPARACION") {
      throw new ServiceError(
        "ESTADO_INVALIDO",
        `El pedido no está disponible para preparación (estado: ${agregado.estado_ecommerce})`,
      );
    }

    if (agregado.operador_asignado_id === actorId) {
      return { cambio_realizado: false, pve_id: agregado.pve_id };
    }

    if (agregado.operador_asignado_id !== null) {
      throw new ServiceError(
        "PEDIDO_YA_TOMADO",
        "El pedido ya fue asignado a otro operador",
      );
    }

    await tx.pedidoVentaEcommerce.update({
      where: { id: agregado.pve_id },
      data: { operador_asignado_id: actorId },
    });

    return { cambio_realizado: true, pve_id: agregado.pve_id };
  });

  if (resultado.cambio_realizado) {
    const payload: EcommercePedidoTomadoPayload = {
      evento_id: crypto.randomUUID(),
      pedido_venta_id: pedidoVentaId,
      pedido_venta_ecommerce_id: resultado.pve_id,
      actor_id: actorId,
      estado: "EN_PREPARACION",
      timestamp: new Date().toISOString(),
    };
    emitirEventoPostCommitSeguro("ecommerce:pedido_tomado", payload, { pedido_venta_id: pedidoVentaId });
  }

  return {
    pedido_venta_id: pedidoVentaId,
    operador_asignado_id: actorId,
    cambio_realizado: resultado.cambio_realizado,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Actualizar prioridad
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cambia o elimina la prioridad manual de un pedido `EN_PREPARACION` libre.
 *
 * @throws {ServiceError} PEDIDO_NO_OPERABLE (404)
 * @throws {ServiceError} ESTADO_INVALIDO (409)
 * @throws {ServiceError} PEDIDO_TOMADO_NO_PRIORIZABLE (409)
 */
export async function actualizarPrioridad(
  pedidoVentaId: string,
  actorId: string,
  prioridadManual: number | null,
): Promise<PrioridadResultado> {
  const resultado = await prisma.$transaction(async (tx) => {
    const agregado = await bloquearAgregadoPickPack(tx, pedidoVentaId);
    if (!agregado) {
      throw new ServiceError(
        "PEDIDO_NO_OPERABLE",
        "El pedido no existe, no es operable o no tiene extensión de e-commerce activa",
      );
    }

    if (agregado.canal !== "WEB") {
      throw new ServiceError("PEDIDO_NO_OPERABLE", "La operación solo aplica a pedidos del canal WEB");
    }

    if (agregado.estado_ecommerce !== "EN_PREPARACION") {
      throw new ServiceError(
        "ESTADO_INVALIDO",
        `El pedido no está en preparación (estado: ${agregado.estado_ecommerce})`,
      );
    }

    if (agregado.operador_asignado_id !== null) {
      throw new ServiceError(
        "PEDIDO_TOMADO_NO_PRIORIZABLE",
        "No se puede cambiar la prioridad de un pedido ya asignado",
      );
    }

    if (agregado.prioridad_manual === prioridadManual) {
      return { prioridad_anterior: agregado.prioridad_manual, cambio_realizado: false, pve_id: agregado.pve_id };
    }

    await tx.pedidoVentaEcommerce.update({
      where: { id: agregado.pve_id },
      data: { prioridad_manual: prioridadManual },
    });

    return { prioridad_anterior: agregado.prioridad_manual, cambio_realizado: true, pve_id: agregado.pve_id };
  });

  if (resultado.cambio_realizado) {
    const payload: EcommercePrioridadPreparacionCambiadaPayload = {
      evento_id: crypto.randomUUID(),
      pedido_venta_id: pedidoVentaId,
      pedido_venta_ecommerce_id: resultado.pve_id,
      actor_id: actorId,
      prioridad_anterior: resultado.prioridad_anterior,
      prioridad_nueva: prioridadManual,
      timestamp: new Date().toISOString(),
    };
    emitirEventoPostCommitSeguro("ecommerce:prioridad_preparacion_cambiada", payload, { pedido_venta_id: pedidoVentaId });
  }

  return {
    pedido_venta_id: pedidoVentaId,
    prioridad_manual: prioridadManual,
    prioridad_anterior: resultado.prioridad_anterior,
    cambio_realizado: resultado.cambio_realizado,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Confirmar ítem por escaneo (T05)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Confirma una unidad de un ítem mediante escaneo. Una lectura nueva válida
 * acredita exactamente una unidad cuantitativa.
 *
 * Idempotente por `scan_id`: si ya existe y coincide con el mismo pedido,
 * actor y código, devuelve la confirmación previa sin efectos nuevos.
 *
 * @throws {ServiceError} PEDIDO_NO_OPERABLE (404)
 * @throws {ServiceError} ESTADO_INVALIDO (409)
 * @throws {ServiceError} PEDIDO_NO_ASIGNADO (409)
 * @throws {ServiceError} OPERADOR_NO_AUTORIZADO (403)
 * @throws {ServiceError} SCAN_ID_CONFLICTO (409)
 * @throws {ServiceError} CODIGO_NO_RESUELTO (409)
 * @throws {ServiceError} CODIGO_NO_PERTENECE_PEDIDO (409)
 * @throws {ServiceError} CANTIDAD_YA_COMPLETA (409)
 */
export async function confirmarItem(
  pedidoVentaId: string,
  actorId: string,
  input: ConfirmarItemPreparacionInput,
): Promise<ResultadoConfirmarItem> {
  const resultado = await prisma.$transaction(async (tx) => {
    // Serializar intenciones sobre el mismo scan_id para evitar P2002 y
    // poder aplicar semántica idempotente de forma segura.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${input.scan_id} || ':pickpack-scan')::bigint)
    `;

    // 1. Revisar si el scan_id ya existe (globalmente UNIQUE).
    const escaneoExistente = await tx.pedidoPreparacionEscaneo.findUnique({
      where: { scan_id: input.scan_id },
      include: {
        pedido_venta_item: {
          select: { pedido_venta_id: true, id: true, variante_sku_id: true },
        },
      },
    });

    if (escaneoExistente) {
      const mismoPedido = escaneoExistente.pedido_venta_item.pedido_venta_id === pedidoVentaId;
      const mismoActor = escaneoExistente.operador_id === actorId;
      const mismoCodigo = escaneoExistente.codigo_escaneado === input.codigo.trim();
      const activo = escaneoExistente.is_active && escaneoExistente.deleted_at === null;

      if (!activo || !mismoPedido || !mismoActor || !mismoCodigo) {
        throw new ServiceError("SCAN_ID_CONFLICTO", "scan_id ya utilizado en otra confirmación");
      }

      const progreso = await calcularProgresoPedido(tx, pedidoVentaId);
      const confirmadosPorItem = await contarEscaneosPorItem(tx, [
        escaneoExistente.pedido_venta_item_id,
      ]);

      return {
        pedido_venta_item_id: escaneoExistente.pedido_venta_item_id,
        variante_sku_id: escaneoExistente.pedido_venta_item.variante_sku_id,
        scan_id: input.scan_id,
        cantidad_confirmada: confirmadosPorItem.get(escaneoExistente.pedido_venta_item_id) ?? 0,
        progreso,
        idempotente: true,
        cambio_realizado: false,
      } satisfies ResultadoConfirmarItem;
    }

    // 2. Bloquear agregado (PedidoVenta → PedidoVentaEcommerce).
    const agregado = await bloquearAgregadoPickPack(tx, pedidoVentaId);
    if (!agregado) {
      throw new ServiceError(
        "PEDIDO_NO_OPERABLE",
        "El pedido no existe, no es operable o no tiene extensión de e-commerce activa",
      );
    }

    if (agregado.canal !== "WEB") {
      throw new ServiceError("PEDIDO_NO_OPERABLE", "La operación solo aplica a pedidos del canal WEB");
    }

    if (agregado.estado_ecommerce !== "EN_PREPARACION") {
      throw new ServiceError(
        "ESTADO_INVALIDO",
        `El pedido no está en preparación (estado: ${agregado.estado_ecommerce})`,
      );
    }

    if (agregado.operador_asignado_id === null) {
      throw new ServiceError("PEDIDO_NO_ASIGNADO", "El pedido no tiene operador asignado");
    }

    if (agregado.operador_asignado_id !== actorId) {
      throw new ServiceError(
        "OPERADOR_NO_AUTORIZADO",
        "El pedido está asignado a otro operador",
      );
    }

    // 3. Bloquear ítems activos en orden determinista.
    const itemsBloqueados = await bloquearItemsPedidoPickPack(tx, pedidoVentaId);
    if (itemsBloqueados.length === 0) {
      throw new ServiceError("PEDIDO_NO_OPERABLE", "El pedido no tiene líneas activas");
    }

    // 4. Resolver código → VarianteSKU.
    const variante = await resolverCodigoEscaneoTx(tx, input.codigo.trim());
    if (!variante) {
      throw new ServiceError(
        "CODIGO_NO_RESUELTO",
        "El código escaneado no corresponde a ninguna variante activa",
      );
    }

    // 5. Encontrar líneas del pedido con esa variante.
    const itemIds = itemsBloqueados.map((i) => i.id);
    const confirmados = await contarEscaneosPorItem(tx, itemIds);

    const lineasCoincidentes = itemsBloqueados.filter(
      (i) => i.variante_sku_id === variante.variante_sku_id,
    );
    if (lineasCoincidentes.length === 0) {
      throw new ServiceError(
        "CODIGO_NO_PERTENECE_PEDIDO",
        "El código escaneado no corresponde a ninguna línea del pedido",
      );
    }

    // 6. Elegir la primera línea pendiente (mismo SKU en varias líneas).
    const lineaPendiente = lineasCoincidentes.find((linea) => {
      const confirmadas = confirmados.get(linea.id) ?? 0;
      return confirmadas < linea.cantidad;
    });

    if (!lineaPendiente) {
      throw new ServiceError(
        "CANTIDAD_YA_COMPLETA",
        "Ya se confirmó toda la cantidad requerida para esta variante",
      );
    }

    // 7. Insertar escaneo.
    await tx.pedidoPreparacionEscaneo.create({
      data: {
        pedido_venta_item_id: lineaPendiente.id,
        operador_id: actorId,
        scan_id: input.scan_id,
        codigo_escaneado: input.codigo.trim(),
      },
    });

    const progreso = await calcularProgresoPedido(tx, pedidoVentaId);
    const cantidadConfirmadaAnterior = confirmados.get(lineaPendiente.id) ?? 0;
    const cantidadConfirmada = cantidadConfirmadaAnterior + 1;

    const txResult: ResultadoConfirmarItem & { pve_id: string; cantidad_confirmada_anterior: number } = {
      pedido_venta_item_id: lineaPendiente.id,
      variante_sku_id: lineaPendiente.variante_sku_id,
      scan_id: input.scan_id,
      cantidad_confirmada: cantidadConfirmada,
      progreso,
      idempotente: false,
      cambio_realizado: true,
      pve_id: agregado.pve_id,
      cantidad_confirmada_anterior: cantidadConfirmadaAnterior,
    };
    return txResult;
  });

  if (resultado.cambio_realizado) {
    const payload: EcommerceUnidadPreparacionConfirmadaPayload = {
      evento_id: crypto.randomUUID(),
      pedido_venta_id: pedidoVentaId,
      pedido_venta_item_id: resultado.pedido_venta_item_id,
      variante_sku_id: resultado.variante_sku_id,
      actor_id: actorId,
      cantidad_confirmada_anterior: resultado.cantidad_confirmada_anterior,
      cantidad_confirmada_nueva: resultado.cantidad_confirmada,
      timestamp: new Date().toISOString(),
    };
    emitirEventoPostCommitSeguro("ecommerce:unidad_preparacion_confirmada", payload, { pedido_venta_id: pedidoVentaId });
  }

  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// Completar preparación (T06)
// ──────────────────────────────────────────────────────────────────────────────

const CLAVE_PLAZO_RETIRO = "ECOMMERCE_PLAZO_RETIRO_DIAS";

function generarTokenRetiro(): string {
  return randomBytes(32).toString("base64url");
}

function parsearDiasRetiro(valor: string | null | undefined): number {
  if (valor == null || valor.trim() === "") {
    throw new ServiceError(
      "CONFIGURACION_INVALIDA",
      `La configuración ${CLAVE_PLAZO_RETIRO} no existe o está vacía`,
    );
  }
  const trimmed = valor.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ServiceError(
      "CONFIGURACION_INVALIDA",
      `La configuración ${CLAVE_PLAZO_RETIRO} debe ser un entero positivo`,
    );
  }
  const numero = Number(trimmed);
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero <= 0) {
    throw new ServiceError(
      "CONFIGURACION_INVALIDA",
      `La configuración ${CLAVE_PLAZO_RETIRO} debe ser un entero positivo`,
    );
  }
  return numero;
}

async function leerDiasRetiro(tx: Prisma.TransactionClient): Promise<number> {
  const config = await tx.configuracionSistema.findUnique({
    where: { clave: CLAVE_PLAZO_RETIRO },
  });
  return parsearDiasRetiro(config?.valor);
}

/**
 * Completa la preparación de un pedido WEB cuando todas sus líneas están
 * confirmadas. Genera el token QR de retiro y calcula el plazo de vencimiento
 * a partir de la configuración del sistema.
 *
 * Idempotente cuando el pedido ya está en `LISTO_PARA_RETIRO` con token y plazo
 * existentes para el mismo operador.
 *
 * @throws {ServiceError} PEDIDO_NO_OPERABLE (404)
 * @throws {ServiceError} OPERADOR_NO_AUTORIZADO (403)
 * @throws {ServiceError} ESTADO_INVALIDO (409)
 * @throws {ServiceError} ESTADO_INCONSISTENTE (409)
 * @throws {ServiceError} PREPARACION_INCOMPLETA (409)
 * @throws {ServiceError} CONFIGURACION_INVALIDA (409)
 */
export async function completarPreparacion(
  pedidoVentaId: string,
  actorId: string,
): Promise<ResultadoCompletarPreparacion> {
  let datosNotificacion: { numero_venta: string; cliente_web_cuenta_id: string | null } | null = null;
  const resultado = await prisma.$transaction(async (tx) => {
    const agregado = await bloquearAgregadoPickPack(tx, pedidoVentaId);
    if (!agregado) {
      throw new ServiceError(
        "PEDIDO_NO_OPERABLE",
        "El pedido no existe, no es operable o no tiene extensión de e-commerce activa",
      );
    }

    if (agregado.canal !== "WEB") {
      throw new ServiceError("PEDIDO_NO_OPERABLE", "La operación solo aplica a pedidos del canal WEB");
    }

    // Idempotencia: ya está LISTO_PARA_RETIRO con token y plazo para el mismo operador.
    if (agregado.estado_ecommerce === "LISTO_PARA_RETIRO") {
      if (agregado.operador_asignado_id !== actorId) {
        throw new ServiceError(
          "OPERADOR_NO_AUTORIZADO",
          "El pedido está asignado a otro operador",
        );
      }
      if (!agregado.codigo_qr_retiro || !agregado.plazo_retiro_vencimiento) {
        throw new ServiceError(
          "ESTADO_INCONSISTENTE",
          "El pedido está LISTO_PARA_RETIRO pero falta token o plazo de retiro",
        );
      }
      const progreso = await calcularProgresoPedido(tx, pedidoVentaId);
      return {
        pedido_venta_id: pedidoVentaId,
        estado_ecommerce: agregado.estado_ecommerce,
        transicion_realizada: false,
        cambio_realizado: false,
        idempotente: true,
        plazo_retiro_vencimiento: agregado.plazo_retiro_vencimiento,
        progreso,
        pve_id: agregado.pve_id,
        vencimiento_iso: agregado.plazo_retiro_vencimiento.toISOString(),
      };
    }

    if (agregado.estado_ecommerce !== "EN_PREPARACION") {
      throw new ServiceError(
        "ESTADO_INVALIDO",
        `El pedido no puede completarse desde el estado ${agregado.estado_ecommerce}`,
      );
    }

    if (agregado.operador_asignado_id === null) {
      throw new ServiceError(
        "PEDIDO_NO_ASIGNADO",
        "El pedido no tiene operador asignado",
      );
    }

    if (agregado.operador_asignado_id !== actorId) {
      throw new ServiceError(
        "OPERADOR_NO_AUTORIZADO",
        "El pedido está asignado a otro operador",
      );
    }

    const itemsBloqueados = await bloquearItemsPedidoPickPack(tx, pedidoVentaId);
    if (itemsBloqueados.length === 0) {
      throw new ServiceError("PEDIDO_NO_OPERABLE", "El pedido no tiene líneas activas");
    }

    const itemIds = itemsBloqueados.map((i) => i.id);
    const confirmados = await contarEscaneosPorItem(tx, itemIds);

    for (const item of itemsBloqueados) {
      const escaneos = confirmados.get(item.id) ?? 0;
      if (escaneos < item.cantidad) {
        throw new ServiceError(
          "PREPARACION_INCOMPLETA",
          "Aún hay líneas sin preparar completamente",
        );
      }
      if (escaneos > item.cantidad) {
        throw new ServiceError(
          "INCONSISTENCIA_PREPARACION",
          "Hay una línea con más confirmaciones que las requeridas",
        );
      }
    }

    const pedidoDestinatario = await tx.pedidoVenta.findUniqueOrThrow({
      where: { id: pedidoVentaId },
      select: { numero_venta: true, cliente_id: true },
    });
    const cuentaOperable = pedidoDestinatario.cliente_id
      ? await tx.cuentaClienteWeb.findFirst({
          where: { cliente_id: pedidoDestinatario.cliente_id, is_active: true, deleted_at: null },
          select: { id: true },
        })
      : null;

    const diasRetiro = await leerDiasRetiro(tx);
    const ahora = new Date();
    const vencimiento = sumarDiasCalendarioNegocio(ahora, diasRetiro);
    const token = generarTokenRetiro();

    await tx.pedidoVentaEcommerce.update({
      where: { id: agregado.pve_id },
      data: {
        estado_ecommerce: "LISTO_PARA_RETIRO",
        codigo_qr_retiro: token,
        plazo_retiro_vencimiento: vencimiento,
      },
    });

    const progreso = await calcularProgresoPedido(tx, pedidoVentaId);

    const txResult: ResultadoCompletarPreparacion & { pve_id: string; vencimiento_iso: string } = {
      pedido_venta_id: pedidoVentaId,
      estado_ecommerce: "LISTO_PARA_RETIRO",
      transicion_realizada: true,
      cambio_realizado: true,
      idempotente: false,
      plazo_retiro_vencimiento: vencimiento,
      progreso,
      pve_id: agregado.pve_id,
      vencimiento_iso: vencimiento.toISOString(),
    };
    datosNotificacion = {
      numero_venta: pedidoDestinatario.numero_venta,
      cliente_web_cuenta_id: cuentaOperable?.id ?? null,
    };
    return txResult;
  });

  if (resultado.cambio_realizado) {
    // El callback transaccional completa esta metadata solo en la transición real.
    const destinatario = datosNotificacion as { numero_venta: string; cliente_web_cuenta_id: string | null } | null;
    if (!destinatario) throw new Error("Faltan datos internos de notificación de retiro");
    const payload: EcommercePedidoListoParaRetiroPayload = {
      evento_id: crypto.randomUUID(),
      pedido_venta_id: pedidoVentaId,
      pedido_venta_ecommerce_id: resultado.pve_id,
      actor_id: actorId,
      estado_anterior: "EN_PREPARACION",
      estado_nuevo: "LISTO_PARA_RETIRO",
      plazo_retiro_vencimiento: resultado.vencimiento_iso,
      timestamp: new Date().toISOString(),
      ...destinatario,
    };
    emitirEventoPostCommitSeguro("ecommerce:pedido_listo_para_retiro", payload, { pedido_venta_id: pedidoVentaId });
  }

  return resultado;
}
