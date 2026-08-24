/**
 * HU-2 — Sección 5.1/5.2: resolución de códigos escaneados contra el
 * catálogo activo y registro transaccional del ingreso de mercadería.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import {
  IMPACTO_STOCK_POR_ESTADO_DESTINO,
  type ResolverCodigoEscaneoInput,
  type RegistrarIngresoPorEscaneoInput,
} from "@/lib/schemas/inventario.schema";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface CodigoResuelto {
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  talle: string;
  color: string;
  /**
   * `VarianteSKU` es un modelo genérico (talle+color+género+modelo), no una
   * unidad serializada individual. El dato de trazabilidad unitaria todavía
   * no existe en el esquema, por lo que siempre se resuelve como `false`/`null`.
   */
  es_serializado: boolean;
  numero_serie: string | null;
}

export interface IngresoRegistrado {
  movimiento_id: string;
  variante_sku_id: string;
  deposito_destino_id: string;
  cantidad: number;
  estado_destino: string;
  /** Dirección en la que este movimiento afectó el disponible — ver `IMPACTO_STOCK_POR_ESTADO_DESTINO`. */
  impacto_stock: "SUMA" | "RESTA";
  stock_resultante: { cantidad: number };
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolución de código escaneado
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve un código escaneado (EAN-13, Code128 o QR serializado como el
 * `sku`) contra el catálogo activo de `VarianteSKU`. Retorna `null` cuando
 * no hay coincidencia — el llamador decide cómo comunicar el "no encontrado".
 */
export async function resolverCodigoEscaneo(
  input: ResolverCodigoEscaneoInput,
): Promise<CodigoResuelto | null> {
  const variante = await prisma.varianteSKU.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
      OR: [{ ean_qr: input.codigo }, { sku: input.codigo }],
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
    es_serializado: false,
    numero_serie: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Registro de ingreso por escaneo
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registra el ingreso de mercadería resuelta por escaneo:
 *  1. Verifica que la variante exista y esté activa.
 *  2. Según `IMPACTO_STOCK_POR_ESTADO_DESTINO[estado_destino]`:
 *     - SUMA: incrementa (o crea) el `StockDeposito` vía `upsert` sobre la
 *       clave compuesta `[variante_sku_id, deposito_id]`.
 *     - RESTA (`RESERVADO`, `VENDIDO`, `BAJA_MERMA`, `EN_TRANSITO`):
 *       decrementa el disponible del mismo depósito seleccionado, con el
 *       mismo patrón atómico condicionado que `decrementarStockConAlerta()`
 *       (`stock.service.ts`) — un `updateMany` con `cantidad: { gte }`
 *       evaluado atómicamente por Postgres, para que el disponible nunca
 *       quede negativo. Si no alcanza, aborta con `STOCK_INSUFICIENTE` y no
 *       se crea ningún movimiento.
 *  3. Crea el `MovimientoStock` inmutable tipo INGRESO (siempre — es lo que
 *     da trazabilidad, incluso cuando el impacto es RESTA).
 *
 * FUERA de la transacción: emite `inventario:ingreso_stock_registrado` y,
 * si el impacto fue RESTA y el resultado cayó al punto de pedido o por
 * debajo, `stock:umbral_critico_alcanzado` (mismo criterio que
 * `decrementarStockConAlerta()`).
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA
 * @throws {ServiceError} STOCK_INSUFICIENTE
 */
export async function registrarIngresoStock(
  input: RegistrarIngresoPorEscaneoInput,
  usuarioId: string,
): Promise<IngresoRegistrado> {
  const impacto = IMPACTO_STOCK_POR_ESTADO_DESTINO[input.estado_destino];

  const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const variante = await tx.varianteSKU.findFirst({
      where: { id: input.variante_sku_id, is_active: true, deleted_at: null },
    });

    if (!variante) {
      throw new ServiceError(
        "VARIANTE_NO_ENCONTRADA",
        `No se encontró la variante ${input.variante_sku_id} en el catálogo activo.`,
      );
    }

    let stockDepositoId: string;
    let cantidadResultante: number;
    let puntoPedido: number;

    if (impacto === "SUMA") {
      const stockActualizado = await tx.stockDeposito.upsert({
        where: {
          variante_sku_id_deposito_id: {
            variante_sku_id: input.variante_sku_id,
            deposito_id: input.deposito_destino_id,
          },
        },
        update: {
          cantidad: { increment: input.cantidad },
          is_active: true,
          deleted_at: null,
        },
        create: {
          variante_sku_id: input.variante_sku_id,
          deposito_id: input.deposito_destino_id,
          cantidad: input.cantidad,
        },
      });
      stockDepositoId = stockActualizado.id;
      cantidadResultante = stockActualizado.cantidad;
      puntoPedido = stockActualizado.punto_pedido;
    } else {
      // Garantiza que exista la fila (en 0 si es la primera vez que se toca
      // esta combinación variante/depósito) para poder aplicarle el
      // decremento condicionado atómico de abajo.
      const stockExistente = await tx.stockDeposito.upsert({
        where: {
          variante_sku_id_deposito_id: {
            variante_sku_id: input.variante_sku_id,
            deposito_id: input.deposito_destino_id,
          },
        },
        update: {},
        create: {
          variante_sku_id: input.variante_sku_id,
          deposito_id: input.deposito_destino_id,
          cantidad: 0,
        },
      });

      const decremento = await tx.stockDeposito.updateMany({
        where: {
          id: stockExistente.id,
          is_active: true,
          cantidad: { gte: input.cantidad }, // condición evaluada atómicamente por PostgreSQL
        },
        data: { cantidad: { decrement: input.cantidad } },
      });

      if (decremento.count === 0) {
        throw new ServiceError(
          "STOCK_INSUFICIENTE",
          `Stock disponible insuficiente en el depósito para restar ${input.cantidad} unidades (hay ${stockExistente.cantidad}).`,
        );
      }

      const stockActualizado = await tx.stockDeposito.findUniqueOrThrow({
        where: { id: stockExistente.id },
      });
      stockDepositoId = stockActualizado.id;
      cantidadResultante = stockActualizado.cantidad;
      puntoPedido = stockActualizado.punto_pedido;
    }

    const movimiento = await tx.movimientoStock.create({
      data: {
        variante_sku_id: input.variante_sku_id,
        deposito_destino_id: input.deposito_destino_id,
        tipo_movimiento: "INGRESO",
        estado_destino: input.estado_destino,
        cantidad: input.cantidad,
        comprobante_referencia: input.comprobante_referencia || null,
        registrado_por_id: usuarioId,
      },
    });

    return {
      movimiento_id: movimiento.id,
      stock_deposito_id: stockDepositoId,
      variante_sku_id: input.variante_sku_id,
      deposito_destino_id: input.deposito_destino_id,
      cantidad: input.cantidad,
      cantidad_resultante: cantidadResultante,
      punto_pedido: puntoPedido,
    };
  });

  domainEventBus.emit("inventario:ingreso_stock_registrado", {
    movimiento_id: resultado.movimiento_id,
    variante_sku_id: resultado.variante_sku_id,
    deposito_destino_id: resultado.deposito_destino_id,
    cantidad: resultado.cantidad,
    cantidad_resultante: resultado.cantidad_resultante,
    usuario_id: usuarioId,
  });

  // Mismo criterio que `decrementarStockConAlerta()`: alerta de umbral
  // crítico fuera de la transacción, y solo cuando el movimiento restó
  // disponible (un ingreso que suma nunca dispara esta alerta).
  if (
    impacto === "RESTA" &&
    resultado.punto_pedido > 0 &&
    resultado.cantidad_resultante <= resultado.punto_pedido
  ) {
    domainEventBus.emit("stock:umbral_critico_alcanzado", {
      stock_deposito_id: resultado.stock_deposito_id,
      variante_sku_id: resultado.variante_sku_id,
      deposito_id: resultado.deposito_destino_id,
      cantidad_resultante: resultado.cantidad_resultante,
      punto_pedido: resultado.punto_pedido,
      movimiento_id_origen: resultado.movimiento_id,
    });
  }

  return {
    movimiento_id: resultado.movimiento_id,
    variante_sku_id: resultado.variante_sku_id,
    deposito_destino_id: resultado.deposito_destino_id,
    cantidad: resultado.cantidad,
    estado_destino: input.estado_destino,
    impacto_stock: impacto,
    stock_resultante: { cantidad: resultado.cantidad_resultante },
  };
}
