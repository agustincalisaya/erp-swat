/**
 * HU-2 — Sección 5.1/5.2: resolución de códigos escaneados contra el
 * catálogo activo y registro transaccional del ingreso de mercadería.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  ResolverCodigoEscaneoInput,
  RegistrarIngresoPorEscaneoInput,
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
   * unidad serializada individual (ver nota en `legajo-prueba.service.ts`).
   * El dato de trazabilidad unitaria todavía no existe en el esquema, por lo
   * que siempre se resuelve como `false`/`null`.
   */
  es_serializado: boolean;
  numero_serie: string | null;
}

export interface IngresoRegistrado {
  movimiento_id: string;
  variante_sku_id: string;
  deposito_destino_id: string;
  cantidad: number;
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
 *  2. Incrementa (o crea) el `StockDeposito` correspondiente vía `upsert`
 *     sobre la clave compuesta `[variante_sku_id, deposito_id]`.
 *  3. Crea el `MovimientoStock` inmutable tipo INGRESO.
 *
 * FUERA de la transacción: emite `inventario:ingreso_stock_registrado`.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA
 */
export async function registrarIngresoStock(
  input: RegistrarIngresoPorEscaneoInput,
  usuarioId: string,
): Promise<IngresoRegistrado> {
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
      variante_sku_id: input.variante_sku_id,
      deposito_destino_id: input.deposito_destino_id,
      cantidad: input.cantidad,
      cantidad_resultante: stockActualizado.cantidad,
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

  return {
    movimiento_id: resultado.movimiento_id,
    variante_sku_id: resultado.variante_sku_id,
    deposito_destino_id: resultado.deposito_destino_id,
    cantidad: resultado.cantidad,
    stock_resultante: { cantidad: resultado.cantidad_resultante },
  };
}
