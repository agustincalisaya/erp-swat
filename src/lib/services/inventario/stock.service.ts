import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  ActualizarUmbralesStockInput,
  CalcularPromedioMovilInput,
  ListarProductosPorDepositoQuery,
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

/**
 * Total físico = disponible en depósitos + unidades actualmente en
 * traslado. HU-A11 (multi-ítem + recepción parcial): "en tránsito" migró de
 * `TransferenciaStock` (cabecera) a `TransferenciaStockItem`, y un remito
 * `PARCIAL` solo tiene EN TRÁNSITO la porción todavía no recibida de cada
 * ítem (`cantidad - cantidad_recibida`), no su `cantidad` despachada
 * completa — de ahí la resta de sumas en vez de un `_sum.cantidad` directo.
 */
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
    prisma.transferenciaStockItem.aggregate({
      where: {
        variante_sku_id: varianteSkuId,
        is_active: true,
        transferencia: { estado: { in: ["EN_TRANSITO", "PARCIAL"] }, is_active: true, deleted_at: null },
      },
      _sum: { cantidad: true, cantidad_recibida: true },
    }),
  ]);
  const cantidadDisponible = disponible._sum.cantidad ?? 0;
  const cantidadTransito = (transito._sum.cantidad ?? 0) - (transito._sum.cantidad_recibida ?? 0);
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

  // HU-A11 (multi-ítem): `variante_sku_id`/`cantidad` migraron de la cabecera
  // `MovimientoStock` al ítem `MovimientoStockItem` — la consulta ahora parte
  // del ítem y filtra la cabecera vía la relación `movimiento`.
  const movimientos = await prisma.movimientoStockItem.findMany({
    where: {
      variante_sku_id: input.variante_sku_id,
      is_active: true,
      movimiento: {
        deposito_origen_id: input.deposito_id,
        tipo_movimiento: { in: ["EGRESO", "TRANSFERENCIA"] },
        is_active: true,
        created_at: { gte: fechaLimite },
      },
    },
    select: { cantidad: true, movimiento: { select: { created_at: true } } },
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
  for (const item of movimientos) {
    const fecha = item.movimiento.created_at;
    const clave = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    egresosPorMes.set(clave, (egresosPorMes.get(clave) ?? 0) + item.cantidad);
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

export interface DecrementoStockResultado {
  stock_deposito_id: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad_resultante: number;
  punto_pedido: number;
}

/**
 * HU-7 — Sección 6.3: núcleo del decremento condicionado de
 * `StockDeposito.cantidad` mediante `updateMany` (patrón obligatorio,
 * spec_modulo_A.md 3.4). Recibe el `tx` del llamador en vez de abrir su
 * propia transacción — permite componerlo dentro de una transacción más
 * grande que mezcle varios ítems (HU-A11, `registrarIngresoStock()`), sin
 * transacciones anidadas. NO compara `punto_pedido` ni emite eventos: eso
 * queda a cargo del llamador, siempre fuera de cualquier transacción (regla
 * de emisión ya establecida en todo el proyecto).
 *
 * @throws {ServiceError} STOCK_INSUFICIENTE
 */
export async function decrementarStockDepositoTx(
  tx: Prisma.TransactionClient,
  params: { stockDepositoId: string; cantidadSolicitada: number },
): Promise<DecrementoStockResultado> {
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

  return {
    stock_deposito_id: stockActualizado.id,
    variante_sku_id: stockActualizado.variante_sku_id,
    deposito_id: stockActualizado.deposito_id,
    cantidad_resultante: stockActualizado.cantidad,
    punto_pedido: stockActualizado.punto_pedido,
  };
}

/**
 * Compara el resultado de un decremento contra `punto_pedido` y emite
 * `stock:umbral_critico_alcanzado` si corresponde. Extraído para que tanto
 * `decrementarStockConAlerta()` como `registrarIngresoStock()` (HU-A11, un
 * decremento por ítem RESTA del lote) compartan la misma regla sin
 * duplicarla. `punto_pedido = 0` (valor por defecto sin configurar) nunca
 * dispara alerta. SIEMPRE se invoca fuera de una transacción.
 */
export function emitirAlertaUmbralSiCorresponde(
  resultado: DecrementoStockResultado,
  movimientoIdOrigen: string,
): void {
  if (resultado.punto_pedido > 0 && resultado.cantidad_resultante <= resultado.punto_pedido) {
    domainEventBus.emit("stock:umbral_critico_alcanzado", {
      stock_deposito_id: resultado.stock_deposito_id,
      variante_sku_id: resultado.variante_sku_id,
      deposito_id: resultado.deposito_id,
      cantidad_resultante: resultado.cantidad_resultante,
      punto_pedido: resultado.punto_pedido,
      movimiento_id_origen: movimientoIdOrigen,
    });
  }
}

/**
 * HU-7 — Sección 6.3: wrapper transaccional de `decrementarStockDepositoTx()`
 * para llamadores que no tienen ya una transacción propia en curso (ej.
 * `reserva.service.ts`). Firma y comportamiento idénticos a los de antes de
 * HU-A11 — el `$transaction` propio y la emisión post-commit del evento de
 * umbral siguen ocurriendo acá.
 *
 * Debe invocarse desde todo movimiento que decremente cantidad (egreso,
 * transferencia — lado origen —, ajuste negativo), no solo desde los
 * endpoints propios de esta HU.
 */
export async function decrementarStockConAlerta(params: {
  stockDepositoId: string;
  cantidadSolicitada: number;
  movimientoIdOrigen: string;
}): Promise<DecrementoStockResultado> {
  const resultado = await prisma.$transaction((tx: Prisma.TransactionClient) =>
    decrementarStockDepositoTx(tx, params),
  );

  emitirAlertaUmbralSiCorresponde(resultado, params.movimientoIdOrigen);

  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-A5 ampliada (Sprint 2) — Consola de Depósito: listado paginado de
// "productos por depósito" con buscador de texto libre (spec_modulo_A.md §2.6 /
// task_HU-A5-ampliacion.md §2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tope duro de ítems por vista de la Consola de Depósito (spec §2.6: "la
 * tabla no admite más de 20 artículos por vista"). El Zod schema ya impone
 * `.max(20)`; esta constante es el segundo cinturón por si el service se
 * invocara desde otro camino sin pasar por el schema.
 */
const PRODUCTOS_POR_DEPOSITO_MAX = 20;

/** Fila del listado de "productos por depósito" (contrato estable spec §2.6). */
export interface ProductoPorDepositoItem {
  stock_deposito_id: string;
  /**
   * UUID de la `VarianteSKU` de la fila. Campo aditivo
   * (task_UI_modal_umbrales_deposito.md, hallazgo 2): habilita la precarga
   * del modal de umbrales desde una fila de la tabla sin re-consultar la
   * cascada Depósito → Producto → Variante. No altera el shape
   * `{ items, paginacion }` ni el contrato genérico que reutiliza HU-A11.
   */
  variante_sku_id: string;
  variante_sku: string;
  producto_nombre: string;
  cantidad: number;
  punto_pedido: number;
  stock_seguridad: number;
}

/** Respuesta de `listarProductosPorDeposito()` — shape `{ items, paginacion }`. */
export interface ListadoProductosPorDeposito {
  items: ProductoPorDepositoItem[];
  paginacion: {
    total: number;
    pagina_actual: number;
    total_paginas: number;
    por_pagina: number;
  };
}

/**
 * HU-A5 ampliada — listado paginado server-side de las variantes con fila de
 * `StockDeposito` en un depósito, con buscador de texto libre. Solo lectura:
 * no abre `$transaction` ni emite eventos de dominio.
 *
 * Reglas no negociables (spec §2.6 / task §2):
 *  - `where` sobre `StockDeposito`: `deposito_id` + `is_active: true`. Se
 *    agrega `variante_sku: { is_active: true }` como guarda de RULES.md
 *    Regla N.° 1 (ningún SELECT operativo expone filas dadas de baja) — mismo
 *    criterio que `obtenerStockDisponible()` en este archivo. No se expone
 *    ningún flag `incluirInactivos` (exclusivo de Auditoría).
 *  - `busqueda`, si viene, se traduce a una condición `OR` con `contains` +
 *    `mode: "insensitive"` sobre `producto_maestro.nombre` Y `variante_sku.sku`,
 *    evaluada en la MISMA query paginada — nunca se trae el dataset a memoria
 *    para filtrar con `.filter()` de JS.
 *  - Paginación: `skip = (pagina - 1) * por_pagina`, `take = por_pagina`
 *    (tope 20). `findMany` + `count` con el mismo `where` para `total` y
 *    `total_paginas = ceil(total / por_pagina)`.
 *  - `deposito_id` inexistente o `is_active: false` → `ServiceError`
 *    `DEPOSITO_NO_ENCONTRADO` (el Route Handler lo mapea a 404).
 *
 * @param input - Query ya validada por `ListarProductosPorDepositoQuerySchema`.
 */
export async function listarProductosPorDeposito(
  input: ListarProductosPorDepositoQuery,
): Promise<ListadoProductosPorDeposito> {
  const deposito = await prisma.deposito.findFirst({
    where: { id: input.deposito_id, is_active: true },
    select: { id: true },
  });

  if (!deposito) {
    throw new ServiceError(
      "DEPOSITO_NO_ENCONTRADO",
      "El depósito indicado no existe o no está activo",
    );
  }

  const porPagina = Math.min(input.por_pagina, PRODUCTOS_POR_DEPOSITO_MAX);

  const where: Prisma.StockDepositoWhereInput = {
    deposito_id: input.deposito_id,
    is_active: true,
    variante_sku: { is_active: true },
  };

  const busqueda = input.busqueda?.trim();
  if (busqueda) {
    where.OR = [
      {
        variante_sku: {
          producto_maestro: { nombre: { contains: busqueda, mode: "insensitive" } },
        },
      },
      { variante_sku: { sku: { contains: busqueda, mode: "insensitive" } } },
    ];
  }

  const skip = (input.pagina - 1) * porPagina;

  const [filas, total] = await Promise.all([
    prisma.stockDeposito.findMany({
      where,
      skip,
      take: porPagina,
      orderBy: { variante_sku: { sku: "asc" } },
      select: {
        id: true,
        cantidad: true,
        punto_pedido: true,
        stock_seguridad: true,
        variante_sku: {
          select: {
            id: true,
            sku: true,
            producto_maestro: { select: { nombre: true } },
          },
        },
      },
    }),
    prisma.stockDeposito.count({ where }),
  ]);

  return {
    items: filas.map((fila) => ({
      stock_deposito_id: fila.id,
      variante_sku_id: fila.variante_sku.id,
      variante_sku: fila.variante_sku.sku,
      producto_nombre: fila.variante_sku.producto_maestro.nombre,
      cantidad: fila.cantidad,
      punto_pedido: fila.punto_pedido,
      stock_seguridad: fila.stock_seguridad,
    })),
    paginacion: {
      total,
      pagina_actual: input.pagina,
      total_paginas: Math.max(1, Math.ceil(total / porPagina)),
      por_pagina: porPagina,
    },
  };
}
