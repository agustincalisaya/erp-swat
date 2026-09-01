/**
 * HU-A10 — Servicio centralizado de Reserva (congelamiento y liberación).
 * spec_modulo_A.md §2.9.
 *
 * El Módulo A es la ÚNICA fuente de verdad de la máquina de estados de
 * "Reservado". Módulo B (HU-B3) y Módulo E (HU-E1) invocarán exclusivamente
 * estas funciones — no implementan lógica de congelamiento/liberación propia.
 *
 * Tres vías de transición:
 *  - Congelamiento .......... `crearReserva()` — DISPONIBLE → RESERVADO.
 *  - Liberación por venta ... `confirmarReservaPorVenta()` — RESERVADO → VENDIDO.
 *  - Liberación por TTL ..... `liberarReservasVencidas()` — RESERVADO → DISPONIBLE
 *                             (job/cron `check-pruebas-vencidas`).
 *
 * Patrón obligatorio (spec §3.4): toda escritura multi-tabla vive dentro de
 * `prisma.$transaction`; el decremento de `StockDeposito` usa `updateMany`
 * condicionado (`where: { cantidad: { gte } }`), nunca `findUnique` + `update`
 * separados. Los eventos de dominio se emiten SIEMPRE fuera de la
 * transacción (regla de emisión, spec §4).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import type { OrigenReserva, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type { CrearReservaInput } from "@/lib/schemas/inventario.schema";

// ──────────────────────────────────────────────────────────────────────────────
// TTL
// ──────────────────────────────────────────────────────────────────────────────

/** TTL por defecto de una Reserva general, en horas (spec §2.9). */
export const TTL_RESERVA_DEFAULT_HORAS = 72;

/**
 * TTL por defecto según `origen_reserva`. Hoy los 3 orígenes generales
 * comparten 72h; el mapa deja explícito el punto de extensión si el negocio
 * define ventanas distintas por origen más adelante.
 */
const TTL_POR_ORIGEN: Record<OrigenReserva, number> = {
  SENIA: TTL_RESERVA_DEFAULT_HORAS,
  LICITACION: TTL_RESERVA_DEFAULT_HORAS,
  PEDIDO_INSTITUCIONAL: TTL_RESERVA_DEFAULT_HORAS,
};

/**
 * Resuelve el TTL efectivo de una reserva: el `ttl_horas` explícito si vino
 * (canal e-commerce), o el default del origen en caso contrario.
 */
export function resolverTtlHoras(origen: OrigenReserva, ttlHorasInput?: number): number {
  return ttlHorasInput ?? TTL_POR_ORIGEN[origen];
}

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno públicos
// ──────────────────────────────────────────────────────────────────────────────

export interface ReservaCongelada {
  reserva_id: string;
  fecha_inicio_reserva: string;
  ttl_horas: number;
}

export interface ReservaConfirmada {
  reserva_id: string;
  fecha_fin_reserva: string;
  estado: "VENDIDO";
}

export interface ReservaLiberadaTtl {
  reserva_id: string;
  variante_sku_id: string;
  cantidad: number;
}

export interface LiberacionTtlResultado {
  total_liberadas: number;
  liberadas: ReservaLiberadaTtl[];
  /** ISO 8601 del umbral usado (`now - ttl_horas`). */
  umbral: string;
  ttl_horas: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.1 — Congelamiento (DISPONIBLE → RESERVADO)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Congela stock creando una `Reserva` activa (`fecha_fin_reserva = null`).
 *
 * Dentro de `prisma.$transaction`:
 *  1. Valida que la variante y el depósito existan y estén activos.
 *  2. Decremento atómico condicionado sobre `StockDeposito.cantidad`
 *     (`updateMany` con `cantidad: { gte }`). Si `count === 0` ⇒
 *     `STOCK_INSUFICIENTE` (`422` en el Route Handler).
 *  3. Crea la fila `Reserva`.
 *  4. Inserta un `MovimientoStock` de auditoría inmutable
 *     (`tipo_movimiento = "AJUSTE"`, `estado_origen = "DISPONIBLE"`,
 *     `estado_destino = "RESERVADO"`) — Regla N.° 2 de RULES.md: el modelo
 *     `Reserva` es el mecanismo operativo, pero NO reemplaza la obligación
 *     de `MovimientoStock` como registro auditado.
 *
 * El congelamiento NO dispara `stock:umbral_critico_alcanzado` — mismo
 * precedente que `crearTransferencia()` (transferencia.service.ts): esa
 * alerta es responsabilidad exclusiva de `decrementarStockConAlerta()`
 * (HU-5), que este flujo no invoca.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA | DEPOSITO_NO_ENCONTRADO (404)
 * @throws {ServiceError} STOCK_INSUFICIENTE (422)
 */
export async function crearReserva(
  input: CrearReservaInput,
  usuarioId: string,
): Promise<ReservaCongelada> {
  const ttlHoras = resolverTtlHoras(input.origen_reserva, input.ttl_horas);
  const reservaId = randomUUID();

  const reserva = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    const decremento = await tx.stockDeposito.updateMany({
      where: {
        variante_sku_id: input.variante_sku_id,
        deposito_id: input.deposito_id,
        is_active: true,
        deleted_at: null,
        cantidad: { gte: input.cantidad },
      },
      data: { cantidad: { decrement: input.cantidad } },
    });
    if (decremento.count === 0) {
      throw new ServiceError(
        "STOCK_INSUFICIENTE",
        "Stock disponible insuficiente en el depósito para congelar la reserva",
      );
    }

    const creada = await tx.reserva.create({
      data: {
        id: reservaId,
        variante_sku_id: input.variante_sku_id,
        deposito_id: input.deposito_id,
        cantidad: input.cantidad,
        origen_reserva: input.origen_reserva,
        motivo: input.motivo ?? null,
        fecha_fin_reserva: null,
        registrado_por_id: usuarioId,
      },
      select: { id: true, fecha_inicio_reserva: true },
    });

    await tx.movimientoStock.create({
      data: {
        variante_sku_id: input.variante_sku_id,
        deposito_origen_id: input.deposito_id,
        tipo_movimiento: "AJUSTE",
        estado_origen: "DISPONIBLE",
        estado_destino: "RESERVADO",
        cantidad: input.cantidad,
        comprobante_referencia: `RESERVA-${creada.id}`,
        registrado_por_id: usuarioId,
      },
    });

    return creada;
  });

  // Regla de emisión (spec §4): SIEMPRE después de que la $transaction resuelve.
  domainEventBus.emit("stock:reserva_congelada", {
    reserva_id: reserva.id,
    variante_sku_id: input.variante_sku_id,
    deposito_id: input.deposito_id,
    usuario_id: usuarioId,
    origen_reserva: input.origen_reserva,
    cantidad: input.cantidad,
  });

  return {
    reserva_id: reserva.id,
    fecha_inicio_reserva: reserva.fecha_inicio_reserva.toISOString(),
    ttl_horas: ttlHoras,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.2 — Liberación por venta confirmada (RESERVADO → VENDIDO)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cierra una `Reserva` activa por venta confirmada: setea
 * `fecha_fin_reserva = now()`. NO reincrementa `StockDeposito.cantidad` — la
 * unidad transiciona a `VENDIDO`, no vuelve a `DISPONIBLE`.
 *
 * Inserta `MovimientoStock` (`tipo_movimiento = "EGRESO"` — la confirmación
 * de venta es la salida definitiva del stock hacia el cliente, no un ajuste
 * administrativo; a diferencia del congelamiento, que sí es `AJUSTE` porque
 * mueve cantidad dentro del mismo stock físico sin salida real;
 * `estado_origen = "RESERVADO"`, `estado_destino = "VENDIDO"`, `venta_id`
 * referenciado en el campo STUB del modelo).
 *
 * El cierre usa `updateMany` condicionado (`fecha_fin_reserva: null`) para
 * cerrar la ventana de carrera con el cron de TTL y una doble confirmación.
 *
 * @throws {ServiceError} RESERVA_NO_ENCONTRADA (404)
 * @throws {ServiceError} RESERVA_INACTIVA — dada de baja lógica (409)
 * @throws {ServiceError} RESERVA_NO_ACTIVA — ya liberada/confirmada (409)
 */
export async function confirmarReservaPorVenta(
  reservaId: string,
  ventaId: string,
  usuarioId: string,
): Promise<ReservaConfirmada> {
  const fechaFin = new Date();

  const reserva = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actual = await tx.reserva.findFirst({
      where: { id: reservaId },
      select: {
        id: true,
        is_active: true,
        deleted_at: true,
        fecha_fin_reserva: true,
        variante_sku_id: true,
        deposito_id: true,
        cantidad: true,
      },
    });
    if (!actual) throw new ServiceError("RESERVA_NO_ENCONTRADA", "La reserva no existe");
    if (!actual.is_active || actual.deleted_at) {
      throw new ServiceError("RESERVA_INACTIVA", "La reserva fue dada de baja");
    }

    const cambio = await tx.reserva.updateMany({
      where: { id: reservaId, is_active: true, deleted_at: null, fecha_fin_reserva: null },
      data: { fecha_fin_reserva: fechaFin },
    });
    if (cambio.count === 0) {
      throw new ServiceError("RESERVA_NO_ACTIVA", "La reserva ya fue liberada o confirmada");
    }

    await tx.movimientoStock.create({
      data: {
        variante_sku_id: actual.variante_sku_id,
        deposito_origen_id: actual.deposito_id,
        tipo_movimiento: "EGRESO",
        estado_origen: "RESERVADO",
        estado_destino: "VENDIDO",
        cantidad: actual.cantidad,
        comprobante_referencia: `RESERVA-CONFIRMADA-${actual.id}`,
        venta_id: ventaId,
        registrado_por_id: usuarioId,
      },
    });

    return actual;
  });

  domainEventBus.emit("stock:reserva_liberada", {
    reserva_id: reserva.id,
    motivo_liberacion: "VENTA",
    variante_sku_id: reserva.variante_sku_id,
    cantidad: reserva.cantidad,
  });

  return {
    reserva_id: reserva.id,
    fecha_fin_reserva: fechaFin.toISOString(),
    estado: "VENDIDO",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.3 — Liberación automática por TTL vencido (RESERVADO → DISPONIBLE)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Libera todas las `Reserva` activas cuyo TTL haya vencido. Invocada por el
 * cron `POST /api/cron/check-pruebas-vencidas`.
 *
 * Selección: `is_active: true`, `fecha_fin_reserva: null`,
 * `fecha_inicio_reserva < now - 72h` — aprovecha el índice compuesto
 * `@@index([is_active, fecha_fin_reserva, fecha_inicio_reserva])`.
 *
 * Por cada reserva vencida, dentro de su propia `prisma.$transaction`:
 *  1. Incrementa `StockDeposito.cantidad` (reversión del congelamiento).
 *  2. Setea `Reserva.fecha_fin_reserva = now()` (soft-close condicionado,
 *     no DELETE físico).
 *  3. Inserta un `MovimientoStock` COMPENSATORIO de tipo `INGRESO`
 *     (⚠️ no `AJUSTE`) — `estado_origen = "RESERVADO"`,
 *     `estado_destino = "DISPONIBLE"`.
 *
 * Una transacción fallida no aborta el resto: se loguea y se continúa.
 * El evento `stock:reserva_liberada` se emite después, para las que
 * efectivamente se liberaron (regla de emisión, spec §4).
 */
export async function liberarReservasVencidas(
  ahora: Date = new Date(),
): Promise<LiberacionTtlResultado> {
  // LIMITACIÓN CONOCIDA: cron aplica 72h fijo por origen, no respeta ttl_horas explícito de e-commerce — resolver al implementar HU-E1
  const ttlHoras = TTL_RESERVA_DEFAULT_HORAS;
  const umbral = new Date(ahora);
  umbral.setHours(umbral.getHours() - ttlHoras);

  const vencidas = await prisma.reserva.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      fecha_fin_reserva: null,
      fecha_inicio_reserva: { lt: umbral },
    },
    select: {
      id: true,
      variante_sku_id: true,
      deposito_id: true,
      cantidad: true,
      registrado_por_id: true,
    },
    orderBy: { fecha_inicio_reserva: "asc" },
  });

  const liberadas: ReservaLiberadaTtl[] = [];

  for (const reserva of vencidas) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const incremento = await tx.stockDeposito.updateMany({
          where: {
            variante_sku_id: reserva.variante_sku_id,
            deposito_id: reserva.deposito_id,
            is_active: true,
            deleted_at: null,
          },
          data: { cantidad: { increment: reserva.cantidad } },
        });
        if (incremento.count === 0) {
          throw new ServiceError(
            "STOCK_DEPOSITO_NO_ENCONTRADO",
            `StockDeposito no encontrado para variante=${reserva.variante_sku_id} / deposito=${reserva.deposito_id}`,
          );
        }

        const cierre = await tx.reserva.updateMany({
          where: { id: reserva.id, is_active: true, deleted_at: null, fecha_fin_reserva: null },
          data: { fecha_fin_reserva: ahora },
        });
        if (cierre.count === 0) {
          throw new ServiceError(
            "RESERVA_NO_ACTIVA",
            `La reserva ${reserva.id} ya fue liberada por otro proceso`,
          );
        }

        await tx.movimientoStock.create({
          data: {
            variante_sku_id: reserva.variante_sku_id,
            deposito_origen_id: reserva.deposito_id,
            tipo_movimiento: "INGRESO",
            estado_origen: "RESERVADO",
            estado_destino: "DISPONIBLE",
            cantidad: reserva.cantidad,
            comprobante_referencia: `CRON-LIBERACION-RESERVA-${reserva.id}`,
            // El cron actúa como agente del sistema: se conserva el ID del
            // registrador original para no romper la cadena de trazabilidad.
            registrado_por_id: reserva.registrado_por_id,
          },
        });
      });

      liberadas.push({
        reserva_id: reserva.id,
        variante_sku_id: reserva.variante_sku_id,
        cantidad: reserva.cantidad,
      });
    } catch (error) {
      console.error(`[liberarReservasVencidas] Error al liberar reserva ${reserva.id}:`, error);
    }
  }

  // Regla de emisión (spec §4): eventos SIEMPRE fuera de la $transaction.
  for (const reserva of liberadas) {
    domainEventBus.emit("stock:reserva_liberada", {
      reserva_id: reserva.reserva_id,
      motivo_liberacion: "TTL_VENCIDO",
      variante_sku_id: reserva.variante_sku_id,
      cantidad: reserva.cantidad,
    });
  }

  return {
    total_liberadas: liberadas.length,
    liberadas,
    umbral: umbral.toISOString(),
    ttl_horas: ttlHoras,
  };
}
