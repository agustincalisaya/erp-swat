import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  ActualizarUmbralesStockInput,
  CalcularPromedioMovilInput,
} from "@/lib/schemas/inventario.schema";

/**
 * HU-7 — Sección 6.1: actualiza `punto_pedido` y `stock_seguridad` de una
 * combinación variante/depósito existente. No toca `cantidad`.
 */
export async function actualizarUmbrales(
  input: ActualizarUmbralesStockInput,
  usuarioId: string,
) {
  const stockDeposito = await prisma.stockDeposito.findFirst({
    where: {
      variante_sku_id: input.variante_sku_id,
      deposito_id: input.deposito_id,
      is_active: true,
    },
  });

  if (!stockDeposito) {
    throw new ServiceError("STOCK_DEPOSITO_NO_ENCONTRADO");
  }

  const actualizado = await prisma.stockDeposito.update({
    where: { id: stockDeposito.id },
    data: {
      punto_pedido: input.punto_pedido,
      stock_seguridad: input.stock_seguridad,
    },
  });

  domainEventBus.emit("stock:umbrales_configurados", {
    stock_deposito_id: actualizado.id,
    variante_sku_id: actualizado.variante_sku_id,
    deposito_id: actualizado.deposito_id,
    usuario_id: usuarioId,
    punto_pedido: actualizado.punto_pedido,
    stock_seguridad: actualizado.stock_seguridad,
  });

  return actualizado;
}

/**
 * HU-7 — Sección 6.2 / 3: promedio móvil mensual de egresos
 * (EGRESO + TRANSFERENCIA salientes) de los últimos `meses_historico` meses.
 * Función de solo lectura, sin efectos secundarios ni emisión de eventos.
 */
export async function calcularPromedioMovilEgresos(
  input: CalcularPromedioMovilInput,
) {
  // Prisma no resuelve aritmética de intervalos dentro del `where`: la
  // fecha límite se calcula en TypeScript antes de construir la consulta.
  const fechaLimite = new Date();
  fechaLimite.setDate(1); // normaliza a inicio de mes: evita el desborde de setMonth()
  fechaLimite.setMonth(fechaLimite.getMonth() - input.meses_historico);

  const movimientos = await prisma.movimientoStock.findMany({
    where: {
      variante_sku_id: input.variante_sku_id,
      deposito_origen_id: input.deposito_id,
      tipo_movimiento: { in: ["EGRESO", "TRANSFERENCIA"] },
      is_active: true,
      created_at: { gte: fechaLimite },
    },
    select: { cantidad: true, created_at: true },
  });

  if (movimientos.length === 0) {
    return {
      promedio_egreso_mensual: 0,
      meses_analizados: input.meses_historico,
      warning: "No hay movimientos históricos en el rango analizado",
    };
  }

  // Agrupa por mes calendario antes de promediar, para suavizar meses parciales.
  const egresosPorMes = new Map<string, number>();
  for (const movimiento of movimientos) {
    const clave = `${movimiento.created_at.getFullYear()}-${movimiento.created_at.getMonth()}`;
    egresosPorMes.set(clave, (egresosPorMes.get(clave) ?? 0) + movimiento.cantidad);
  }

  const totalEgresos = [...egresosPorMes.values()].reduce(
    (acumulado, cantidad) => acumulado + cantidad,
    0,
  );

  return {
    promedio_egreso_mensual: totalEgresos / input.meses_historico,
    meses_analizados: input.meses_historico,
    warning: null,
  };
}

/**
 * HU-7 — Sección 6.3: decrementa `StockDeposito.cantidad` mediante el patrón
 * obligatorio de `updateMany` condicionado (spec_modulo_A.md 3.4). La
 * transacción retorna un objeto plano; la comparación contra `punto_pedido`
 * y la emisión de `stock:umbral_critico_alcanzado` ocurren FUERA de ella.
 *
 * Debe invocarse desde todo movimiento que decremente cantidad (egreso,
 * transferencia — lado origen —, ajuste negativo), no solo desde los
 * endpoints propios de esta HU.
 */
export async function decrementarStockConAlerta(params: {
  stockDepositoId: string;
  cantidadSolicitada: number;
  movimientoIdOrigen: string;
}) {
  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const update = await tx.stockDeposito.updateMany({
      where: {
        id: params.stockDepositoId,
        is_active: true,
        cantidad: { gte: params.cantidadSolicitada }, // condición evaluada atómicamente por PostgreSQL
      },
      data: {
        cantidad: { decrement: params.cantidadSolicitada },
      },
    });

    if (update.count === 0) {
      throw new ServiceError("STOCK_INSUFICIENTE");
    }

    const stockActualizado = await tx.stockDeposito.findUniqueOrThrow({
      where: { id: params.stockDepositoId, is_active: true },
    });

    // La transacción retorna datos planos; NO emite eventos aquí adentro.
    return {
      stock_deposito_id: stockActualizado.id,
      variante_sku_id: stockActualizado.variante_sku_id,
      deposito_id: stockActualizado.deposito_id,
      cantidad_resultante: stockActualizado.cantidad,
      punto_pedido: stockActualizado.punto_pedido,
    };
  });

  // Fuera de la transacción: comparación y emisión del evento.
  // punto_pedido = 0 (valor por defecto sin configurar) no dispara alerta.
  if (resultado.punto_pedido > 0 && resultado.cantidad_resultante <= resultado.punto_pedido) {
    domainEventBus.emit("stock:umbral_critico_alcanzado", {
      stock_deposito_id: resultado.stock_deposito_id,
      variante_sku_id: resultado.variante_sku_id,
      deposito_id: resultado.deposito_id,
      cantidad_resultante: resultado.cantidad_resultante,
      punto_pedido: resultado.punto_pedido,
      movimiento_id_origen: params.movimientoIdOrigen,
    });
  }

  return resultado;
}
