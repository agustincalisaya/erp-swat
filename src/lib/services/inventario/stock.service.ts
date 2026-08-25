import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  ActualizarUmbralesStockInput,
  CalcularPromedioMovilInput,
} from "@/lib/schemas/inventario.schema";
import { calcularResumenStock } from "@/lib/services/inventario/stock-calculos";

/**
 * HU-7 — Sección 6.1: configura `punto_pedido` y `stock_seguridad` de una
 * combinación variante/depósito. Nunca toca `cantidad` salvo por su valor
 * inicial (0) cuando la combinación no existe todavía.
 *
 * Selector jerárquico (task_cali_selector_umbrales.md, sección 2): permite
 * elegir variantes sin stock cargado — por lo tanto ya no puede exigir que
 * la fila de `StockDeposito` exista de antemano. `upsert` sobre la clave
 * compuesta `[variante_sku_id, deposito_id]`, mismo patrón que
 * `registrarIngresoStock()` en `movimiento.service.ts`.
 */
export async function actualizarUmbrales(
  input: ActualizarUmbralesStockInput,
  usuarioId: string,
) {
  const actualizado = await prisma.stockDeposito.upsert({
    where: {
      variante_sku_id_deposito_id: {
        variante_sku_id: input.variante_sku_id,
        deposito_id: input.deposito_id,
      },
    },
    update: {
      punto_pedido: input.punto_pedido,
      stock_seguridad: input.stock_seguridad,
    },
    create: {
      variante_sku_id: input.variante_sku_id,
      deposito_id: input.deposito_id,
      cantidad: 0,
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

export interface StockDepositoCombinacion {
  variante_sku_id: string;
  deposito_id: string;
  cantidad: number;
  punto_pedido: number;
  stock_seguridad: number;
}

/**
 * Selector jerárquico (task_cali_selector_umbrales.md, sección 3): lectura
 * de solo consulta para poblar `FormularioUmbralesStock` al completar los 3
 * niveles del selector. Devuelve `null` cuando la combinación no tiene fila
 * en `StockDeposito` todavía — el llamador lo interpreta como "sin stock
 * cargado" (valores en 0, indicador visible en el formulario), no como error.
 */
export async function obtenerStockDepositoPorCombinacion(
  varianteSkuId: string,
  depositoId: string,
): Promise<StockDepositoCombinacion | null> {
  const stockDeposito = await prisma.stockDeposito.findFirst({
    where: {
      variante_sku_id: varianteSkuId,
      deposito_id: depositoId,
      is_active: true,
    },
    select: {
      variante_sku_id: true,
      deposito_id: true,
      cantidad: true,
      punto_pedido: true,
      stock_seguridad: true,
    },
  });

  return stockDeposito;
}

/**
 * Sección 5.2: factores que traducen el promedio de egresos mensuales en
 * umbrales sugeridos. `factor_seguridad` < `factor_lead_time` preserva la
 * semántica `stock_seguridad < punto_pedido` (sección 2 de la tarea).
 * Constantes de negocio ajustables — documentadas aquí, no en el Route Handler.
 */
const FACTOR_LEAD_TIME = 0.5; // ~2 semanas de cobertura sobre el promedio mensual
const FACTOR_SEGURIDAD = 0.25;

/** Stock vendible, siempre acotado a una variante y un depósito concretos. */
export async function obtenerStockDisponible(varianteSkuId: string, depositoId: string): Promise<number> {
  const stock = await prisma.stockDeposito.findFirst({
    where: {
      variante_sku_id: varianteSkuId,
      deposito_id: depositoId,
      is_active: true,
      deleted_at: null,
      variante_sku: { is_active: true, deleted_at: null },
      deposito: { is_active: true, deleted_at: null },
    },
    select: { cantidad: true },
  });
  return stock?.cantidad ?? 0;
}

/** Total físico = disponible en depósitos + unidades actualmente en traslado. */
export async function obtenerStockFisicoTotal(varianteSkuId: string): Promise<{
  disponible: number;
  en_transito: number;
  total_fisico: number;
}> {
  const [disponible, transito] = await Promise.all([
    prisma.stockDeposito.aggregate({
      where: { variante_sku_id: varianteSkuId, is_active: true, deleted_at: null },
      _sum: { cantidad: true },
    }),
    prisma.transferenciaStock.aggregate({
      where: { variante_sku_id: varianteSkuId, estado: "EN_TRANSITO", is_active: true, deleted_at: null },
      _sum: { cantidad: true },
    }),
  ]);
  const cantidadDisponible = disponible._sum.cantidad ?? 0;
  const cantidadTransito = transito._sum.cantidad ?? 0;
  return calcularResumenStock(cantidadDisponible, cantidadTransito);
}

/**
 * HU-7 — Sección 6.2 / 3: promedio móvil mensual de egresos
 * (EGRESO + TRANSFERENCIA salientes) de los últimos `meses_historico` meses,
 * y umbrales sugeridos (sección 5.2) derivados de ese promedio.
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
      punto_pedido_sugerido: null,
      stock_seguridad_sugerido: null,
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

  const promedio_egreso_mensual = totalEgresos / input.meses_historico;

  return {
    promedio_egreso_mensual,
    punto_pedido_sugerido: Math.ceil(promedio_egreso_mensual * FACTOR_LEAD_TIME),
    stock_seguridad_sugerido: Math.ceil(promedio_egreso_mensual * FACTOR_SEGURIDAD),
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
