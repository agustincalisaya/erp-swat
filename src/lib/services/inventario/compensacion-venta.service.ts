import "server-only";

import { type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";

export interface CompensarVentaPagadaInput {
  reintegro_id: string;
  compensacion_id: string;
  registrado_por_id: string;
  motivo: string;
}

export type CompensacionVentaResultado = {
  resultado: "CREADO" | "YA_EXISTENTE";
  compensacion_id: string;
  movimiento_stock_id: string;
  pedido_venta_item_id: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad: number;
};

type CompensacionBloqueada = {
  id: string;
  reintegro_id: string;
  pedido_venta_item_id: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad: number;
  clave_idempotencia: string;
  movimiento_stock_id: string | null;
  completed_at: Date | null;
};

function movimientoCoincide(
  movimiento: {
    tipo_movimiento: string;
    deposito_origen_id: string | null;
    deposito_destino_id: string | null;
    comprobante_referencia: string | null;
    venta_id: string | null;
    is_active: boolean;
    deleted_at: Date | null;
    items: Array<{
      variante_sku_id: string;
      cantidad: number;
      estado_origen: string | null;
      estado_destino: string | null;
      is_active: boolean;
      deleted_at: Date | null;
    }>;
  },
  esperado: {
    pedido_venta_id: string;
    variante_sku_id: string;
    deposito_id: string;
    cantidad: number;
    clave_idempotencia: string;
  },
): boolean {
  const item = movimiento.items[0];
  return movimiento.tipo_movimiento === "INGRESO" &&
    movimiento.deposito_origen_id === null &&
    movimiento.deposito_destino_id === esperado.deposito_id &&
    movimiento.comprobante_referencia === esperado.clave_idempotencia &&
    movimiento.venta_id === esperado.pedido_venta_id &&
    movimiento.is_active &&
    movimiento.deleted_at === null &&
    movimiento.items.length === 1 &&
    item?.variante_sku_id === esperado.variante_sku_id &&
    item.cantidad === esperado.cantidad &&
    item.estado_origen === "VENDIDO" &&
    item.estado_destino === "DISPONIBLE" &&
    item.is_active &&
    item.deleted_at === null;
}

export async function compensarVentaPagadaTx(
  tx: Prisma.TransactionClient,
  input: CompensarVentaPagadaInput,
): Promise<CompensacionVentaResultado> {
  const filas = await tx.$queryRaw<CompensacionBloqueada[]>`
    SELECT id, reintegro_id, pedido_venta_item_id, variante_sku_id, deposito_id,
           cantidad, clave_idempotencia, movimiento_stock_id, completed_at
    FROM reintegro_stock_compensaciones
    WHERE id = ${input.compensacion_id}
    FOR UPDATE
  `;
  const compensacion = filas[0];
  if (!compensacion) {
    throw new ServiceError("COMPENSACION_NO_ENCONTRADA", "La compensación de stock no existe");
  }
  if (compensacion.reintegro_id !== input.reintegro_id) {
    throw new ServiceError("COMPENSACION_REINTEGRO_INCOMPATIBLE", "La compensación no pertenece al reintegro indicado");
  }
  if (!Number.isInteger(compensacion.cantidad) || compensacion.cantidad <= 0) {
    throw new ServiceError("COMPENSACION_CANTIDAD_INVALIDA", "La cantidad a compensar debe ser positiva");
  }

  const reintegro = await tx.reintegroPedidoWeb.findUnique({
    where: { id: compensacion.reintegro_id },
    select: { pedido_venta_id: true },
  });
  const item = await tx.pedidoVentaItem.findUnique({
    where: { id: compensacion.pedido_venta_item_id },
    select: {
      id: true,
      pedido_venta_id: true,
      variante_sku_id: true,
      cantidad: true,
      cantidad_facturada: true,
      cantidad_entregada: true,
      reserva: {
        select: {
          id: true,
          variante_sku_id: true,
          deposito_id: true,
          cantidad: true,
          fecha_fin_reserva: true,
        },
      },
    },
  });
  if (!reintegro || !item || item.pedido_venta_id !== reintegro.pedido_venta_id) {
    throw new ServiceError("COMPENSACION_ITEM_INCOMPATIBLE", "El ítem no pertenece al pedido reintegrado");
  }
  if (compensacion.clave_idempotencia !== `HU-E13:STOCK:${reintegro.pedido_venta_id}:${item.id}`) {
    throw new ServiceError("COMPENSACION_CLAVE_INCOMPATIBLE", "La clave no identifica la compensación HU-E13 esperada");
  }
  if (!item.reserva || item.reserva.fecha_fin_reserva === null) {
    throw new ServiceError("COMPENSACION_SIN_EVIDENCIA_VENTA", "El ítem no tiene una reserva vendida trazable");
  }
  if (compensacion.variante_sku_id !== item.variante_sku_id || item.reserva.variante_sku_id !== item.variante_sku_id) {
    throw new ServiceError("COMPENSACION_SKU_INCOMPATIBLE", "La variante no coincide con el ítem vendido");
  }
  if (compensacion.deposito_id !== item.reserva.deposito_id) {
    throw new ServiceError("COMPENSACION_DEPOSITO_INCOMPATIBLE", "El depósito no coincide con la reserva vendida");
  }
  if (
    compensacion.cantidad > item.cantidad ||
    compensacion.cantidad > item.cantidad_facturada ||
    compensacion.cantidad > item.reserva.cantidad ||
    item.cantidad_entregada !== 0
  ) {
    throw new ServiceError("COMPENSACION_CANTIDAD_INVALIDA", "La cantidad excede la venta restituible");
  }

  const movimientosVenta = await tx.movimientoStock.findMany({
    where: {
      venta_id: reintegro.pedido_venta_id,
      deposito_origen_id: item.reserva.deposito_id,
      tipo_movimiento: "EGRESO",
      comprobante_referencia: `RESERVA-CONFIRMADA-${item.reserva.id}`,
      is_active: true,
      deleted_at: null,
    },
    include: { items: true },
    take: 2,
  });
  const movimientoVenta = movimientosVenta[0];
  const evidenciaVentaValida = movimientosVenta.length === 1 &&
    movimientoVenta?.items.length === 1 &&
    movimientoVenta.items[0]?.variante_sku_id === item.variante_sku_id &&
    movimientoVenta.items[0].cantidad === item.reserva.cantidad &&
    movimientoVenta.items[0].estado_origen === "RESERVADO" &&
    movimientoVenta.items[0].estado_destino === "VENDIDO";
  if (!evidenciaVentaValida) {
    throw new ServiceError("COMPENSACION_SIN_EVIDENCIA_VENTA", "No existe un movimiento de venta inequívoco para el ítem");
  }

  if (compensacion.movimiento_stock_id) {
    if (!compensacion.completed_at) {
      throw new ServiceError("COMPENSACION_MOVIMIENTO_INCOMPATIBLE", "La compensación vinculada no está completa");
    }
    const existente = await tx.movimientoStock.findUnique({
      where: { id: compensacion.movimiento_stock_id },
      include: { items: true },
    });
    if (!existente || !movimientoCoincide(existente, {
      pedido_venta_id: reintegro.pedido_venta_id,
      variante_sku_id: compensacion.variante_sku_id,
      deposito_id: compensacion.deposito_id,
      cantidad: compensacion.cantidad,
      clave_idempotencia: compensacion.clave_idempotencia,
    })) {
      throw new ServiceError("COMPENSACION_MOVIMIENTO_INCOMPATIBLE", "El movimiento vinculado no coincide con la compensación");
    }
    return {
      resultado: "YA_EXISTENTE",
      compensacion_id: compensacion.id,
      movimiento_stock_id: existente.id,
      pedido_venta_item_id: compensacion.pedido_venta_item_id,
      variante_sku_id: compensacion.variante_sku_id,
      deposito_id: compensacion.deposito_id,
      cantidad: compensacion.cantidad,
    };
  }

  const stockActualizado = await tx.stockDeposito.updateMany({
    where: {
      variante_sku_id: compensacion.variante_sku_id,
      deposito_id: compensacion.deposito_id,
      is_active: true,
      deleted_at: null,
    },
    data: { cantidad: { increment: compensacion.cantidad } },
  });
  if (stockActualizado.count !== 1) {
    throw new ServiceError("COMPENSACION_DEPOSITO_INVALIDO", "No existe stock activo para el SKU y depósito de la venta");
  }

  const movimiento = await tx.movimientoStock.create({
    data: {
      deposito_destino_id: compensacion.deposito_id,
      tipo_movimiento: "INGRESO",
      comprobante_referencia: compensacion.clave_idempotencia,
      registrado_por_id: input.registrado_por_id,
      venta_id: reintegro.pedido_venta_id,
      items: {
        create: {
          variante_sku_id: compensacion.variante_sku_id,
          cantidad: compensacion.cantidad,
          estado_origen: "VENDIDO",
          estado_destino: "DISPONIBLE",
          motivo: input.motivo,
        },
      },
    },
  });
  const completada = await tx.reintegroStockCompensacion.updateMany({
    where: { id: compensacion.id, reintegro_id: compensacion.reintegro_id, movimiento_stock_id: null },
    data: { movimiento_stock_id: movimiento.id, completed_at: new Date() },
  });
  if (completada.count !== 1) {
    throw new ServiceError("COMPENSACION_MODIFICADA", "La compensación cambió durante la restitución de stock");
  }

  return {
    resultado: "CREADO",
    compensacion_id: compensacion.id,
    movimiento_stock_id: movimiento.id,
    pedido_venta_item_id: compensacion.pedido_venta_item_id,
    variante_sku_id: compensacion.variante_sku_id,
    deposito_id: compensacion.deposito_id,
    cantidad: compensacion.cantidad,
  };
}

export async function compensarVentaPagada(
  input: CompensarVentaPagadaInput,
): Promise<CompensacionVentaResultado> {
  return prisma.$transaction((tx) => compensarVentaPagadaTx(tx, input));
}
