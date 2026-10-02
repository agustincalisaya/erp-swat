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
 *  - Liberación inmediata ... `liberarReservasTx()` — RESERVADO → DISPONIBLE
 *                             por rechazo del pago web (HU-E2).
 *
 * Las variantes `…Tx()` reciben el `tx` del llamador (checkout/pago web, que
 * confirman todo en una sola transacción) y NO emiten eventos.
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
import type { ReservaCongeladaPayload, ReservaLiberadaPayload } from "@/lib/events/event-types";

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
  // HU-E1 (D3): el checkout web SIEMPRE manda `ttl_horas` explícito
  // (`ECOMMERCE_CHECKOUT_TTL_HORAS`); el default solo cubre el `Record` exhaustivo.
  CHECKOUT_WEB: TTL_RESERVA_DEFAULT_HORAS,
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
  /**
   * ISO 8601 del corte usado: se liberan las reservas con
   * `fecha_expiracion <= umbral` (HU-A10 Rev. 3). El TTL ya no es un valor
   * único del cron — cada reserva trae el suyo persistido.
   */
  umbral: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.1 — Congelamiento (DISPONIBLE → RESERVADO)
// ──────────────────────────────────────────────────────────────────────────────

/** Resultado de `crearReservaTx()`: la reserva más el payload del evento que
 * el llamador debe emitir DESPUÉS del commit (`emitirReservaCongelada()`). */
export interface ReservaCongeladaTx extends ReservaCongelada {
  evento: ReservaCongeladaPayload;
}

/**
 * HU-E1 (D2) — núcleo del congelamiento: recibe el `tx` del llamador en vez de
 * abrir su propia transacción, para que un checkout de N ítems congele todo o
 * nada dentro de una única `$transaction` (mismo patrón que
 * `decrementarStockDepositoTx()`/`decrementarStockConAlerta()` de
 * `stock.service.ts`). NO emite eventos: devuelve el payload en `evento` y el
 * llamador lo emite con `emitirReservaCongelada()` fuera de la transacción.
 *
 * Dentro del `tx` recibido:
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
export async function crearReservaTx(
  tx: Prisma.TransactionClient,
  input: CrearReservaInput,
  usuarioId: string,
): Promise<ReservaCongeladaTx> {
  const ttlHoras = resolverTtlHoras(input.origen_reserva, input.ttl_horas);
  const reservaId = randomUUID();
  // HU-A10 Rev. 3: el vencimiento se precomputa y persiste al congelar
  // (`fecha_inicio_reserva + ttl_horas`), así el cron respeta el TTL real de
  // cada reserva — incluido el `ttl_horas` acotado de e-commerce.
  const fechaInicioReserva = new Date();
  const fechaExpiracion = new Date(fechaInicioReserva.getTime() + ttlHoras * 60 * 60 * 1000);

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
      fecha_inicio_reserva: fechaInicioReserva,
      fecha_expiracion: fechaExpiracion,
      fecha_fin_reserva: null,
      registrado_por_id: usuarioId,
    },
    select: { id: true, fecha_inicio_reserva: true },
  });

  // HU-A11 (multi-ítem): mismo patrón cabecera + 1 ítem que en
  // `confirmarReservaPorVenta()`/`liberarReservasVencidas()`.
  await tx.movimientoStock.create({
    data: {
      deposito_origen_id: input.deposito_id,
      tipo_movimiento: "AJUSTE",
      comprobante_referencia: `RESERVA-${creada.id}`,
      registrado_por_id: usuarioId,
      items: {
        create: {
          variante_sku_id: input.variante_sku_id,
          cantidad: input.cantidad,
          estado_origen: "DISPONIBLE",
          estado_destino: "RESERVADO",
        },
      },
    },
  });

  return {
    reserva_id: creada.id,
    fecha_inicio_reserva: creada.fecha_inicio_reserva.toISOString(),
    ttl_horas: ttlHoras,
    evento: {
      reserva_id: creada.id,
      variante_sku_id: input.variante_sku_id,
      deposito_id: input.deposito_id,
      usuario_id: usuarioId,
      origen_reserva: input.origen_reserva,
      cantidad: input.cantidad,
    },
  };
}

/**
 * Congela stock creando una `Reserva` activa (`fecha_fin_reserva = null`).
 * Wrapper transaccional de `crearReservaTx()` para llamadores sin transacción
 * propia (HU-B1, HU-B3, Route Handler de HU-A10). Firma y comportamiento
 * idénticos a los previos a HU-E1: abre su propia `$transaction` y emite
 * `stock:reserva_congelada` después del commit.
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA | DEPOSITO_NO_ENCONTRADO (404)
 * @throws {ServiceError} STOCK_INSUFICIENTE (422)
 */
export async function crearReserva(
  input: CrearReservaInput,
  usuarioId: string,
): Promise<ReservaCongelada> {
  const { evento, ...reserva } = await prisma.$transaction((tx: Prisma.TransactionClient) =>
    crearReservaTx(tx, input, usuarioId),
  );

  // Regla de emisión (spec §4): SIEMPRE después de que la $transaction resuelve.
  emitirReservaCongelada(evento);

  return reserva;
}

/** Emite `stock:reserva_congelada` para una reserva creada con
 * `crearReservaTx()`. SIEMPRE fuera de la transacción (regla de emisión §4). */
export function emitirReservaCongelada(evento: ReservaCongeladaPayload): void {
  domainEventBus.emit("stock:reserva_congelada", evento);
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
  const confirmada = await prisma.$transaction((tx: Prisma.TransactionClient) =>
    confirmarReservaPorVentaTx(tx, reservaId, ventaId, usuarioId),
  );
  domainEventBus.emit("stock:reserva_liberada", confirmada.evento);
  return confirmada.resultado;
}

/** Resultado de `confirmarReservaPorVentaTx()`: la confirmación más el payload
 * que el llamador emite DESPUÉS del commit (`stock:reserva_liberada`, VENTA). */
export interface ReservaConfirmadaTx {
  resultado: ReservaConfirmada;
  evento: ReservaLiberadaPayload;
}

/**
 * HU-E2 — núcleo de `confirmarReservaPorVenta()` sobre el `tx` del llamador
 * (mismo patrón que `crearReservaTx()`): el pago web confirma stock, factura y
 * comprobante en UNA transacción. No abre transacción ni emite eventos.
 *
 * @throws {ServiceError} RESERVA_NO_ENCONTRADA | RESERVA_INACTIVA | RESERVA_NO_ACTIVA
 */
export async function confirmarReservaPorVentaTx(
  tx: Prisma.TransactionClient,
  reservaId: string,
  ventaId: string,
  usuarioId: string,
  fechaFin: Date = new Date(),
): Promise<ReservaConfirmadaTx> {
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

  // HU-A11 (multi-ítem): MovimientoStock es cabecera pura desde acá —
  // variante_sku_id/cantidad/estado_* migraron a un MovimientoStockItem
  // hijo (siempre uno solo, esta reserva es de una única variante).
  await tx.movimientoStock.create({
    data: {
      deposito_origen_id: actual.deposito_id,
      tipo_movimiento: "EGRESO",
      comprobante_referencia: `RESERVA-CONFIRMADA-${actual.id}`,
      venta_id: ventaId,
      registrado_por_id: usuarioId,
      items: {
        create: {
          variante_sku_id: actual.variante_sku_id,
          cantidad: actual.cantidad,
          estado_origen: "RESERVADO",
          estado_destino: "VENDIDO",
        },
      },
    },
  });

  return {
    resultado: { reserva_id: actual.id, fecha_fin_reserva: fechaFin.toISOString(), estado: "VENDIDO" },
    evento: {
      reserva_id: actual.id,
      motivo_liberacion: "VENTA",
      variante_sku_id: actual.variante_sku_id,
      cantidad: actual.cantidad,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.3 — Liberación automática por TTL vencido (RESERVADO → DISPONIBLE)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Libera todas las `Reserva` activas cuyo TTL haya vencido. Invocada por el
 * cron `POST /api/cron/check-pruebas-vencidas`.
 *
 * Selección (HU-A10 Rev. 3, spec §2.9): `is_active: true`,
 * `fecha_fin_reserva: null`, `fecha_expiracion <= now()` — respeta el TTL
 * persistido de cada reserva individual (default 72h o el `ttl_horas`
 * explícito con el que se congeló). Aprovecha el índice compuesto
 * `@@index([is_active, fecha_fin_reserva, fecha_expiracion])`.
 *
 * Por cada reserva vencida, dentro de su propia `prisma.$transaction`, aplica
 * el núcleo `liberarReservaVencidaTx()` (ver abajo): cierre condicionado de la
 * reserva, reincremento de `StockDeposito.cantidad` y `MovimientoStock`
 * compensatorio `INGRESO` RESERVADO→DISPONIBLE.
 *
 * Una transacción fallida no aborta el resto: se loguea y se continúa.
 * El evento `stock:reserva_liberada` se emite después, para las que
 * efectivamente se liberaron (regla de emisión, spec §4).
 */
export async function liberarReservasVencidas(
  ahora: Date = new Date(),
): Promise<LiberacionTtlResultado> {
  const umbral = ahora;

  const vencidas = await prisma.reserva.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      fecha_fin_reserva: null,
      fecha_expiracion: { lte: umbral },
    },
    select: {
      id: true,
      variante_sku_id: true,
      deposito_id: true,
      cantidad: true,
      registrado_por_id: true,
    },
    orderBy: { fecha_expiracion: "asc" },
  });

  const liberadas: ReservaLiberadaTtl[] = [];

  for (const reserva of vencidas) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // HU-E1: núcleo compartido con `liberarReservasVencidasTx()`. Si otro
        // proceso ya la cerró, el núcleo no toca nada y acá se sigue tratando
        // como antes (RESERVA_NO_ACTIVA → log y se continúa con la siguiente).
        const liberada = await liberarReservaVencidaTx(tx, reserva, ahora);
        if (!liberada) {
          throw new ServiceError(
            "RESERVA_NO_ACTIVA",
            `La reserva ${reserva.id} ya fue liberada por otro proceso`,
          );
        }
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
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.4 — HU-E1 (D4.2): liberación de vencidas dentro de la transacción de otro
// módulo (checkout web), acotada por depósito y SKU.
// ──────────────────────────────────────────────────────────────────────────────

/** Reserva vencida seleccionada para liberar (shape de los dos `findMany`). */
interface ReservaVencidaSeleccionada {
  id: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad: number;
  registrado_por_id: string;
}

/**
 * Núcleo de la transición RESERVADO → DISPONIBLE por TTL, sobre el `tx` del
 * llamador (lo usan `liberarReservasVencidas()` y `liberarReservasVencidasTx()`).
 *
 *  1. Cierre condicionado (`updateMany` con `fecha_fin_reserva: null`): toma el
 *     lock de la fila. Si otra transacción la cerró antes, PostgreSQL reevalúa
 *     el `where` al liberarse el lock → `count === 0` → devuelve `false` SIN
 *     reincrementar stock (nunca se devuelve dos veces la misma unidad).
 *  2. Reincremento de `StockDeposito.cantidad`.
 *  3. `MovimientoStock` COMPENSATORIO de tipo `INGRESO` (⚠️ no `AJUSTE`),
 *     `estado_origen = "RESERVADO"`, `estado_destino = "DISPONIBLE"`.
 *
 * HU-E2: también lo usa `liberarReservasTx()` (rechazo del pago web), que
 * pasa su propio prefijo de `comprobante_referencia`.
 *
 * @returns `true` si la liberó esta llamada, `false` si ya estaba cerrada.
 * @throws {ServiceError} STOCK_DEPOSITO_NO_ENCONTRADO
 */
async function liberarReservaVencidaTx(
  tx: Prisma.TransactionClient,
  reserva: ReservaVencidaSeleccionada,
  ahora: Date,
  prefijoReferencia = "CRON-LIBERACION-RESERVA",
): Promise<boolean> {
  const cierre = await tx.reserva.updateMany({
    where: { id: reserva.id, is_active: true, deleted_at: null, fecha_fin_reserva: null },
    data: { fecha_fin_reserva: ahora },
  });
  if (cierre.count === 0) return false;

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

  // HU-A11 (multi-ítem): mismo patrón cabecera + 1 ítem que en
  // `confirmarReservaPorVenta()` — ver comentario ahí.
  await tx.movimientoStock.create({
    data: {
      deposito_origen_id: reserva.deposito_id,
      tipo_movimiento: "INGRESO",
      comprobante_referencia: `${prefijoReferencia}-${reserva.id}`,
      // Se conserva el ID del registrador original para no romper la cadena
      // de trazabilidad (el job/checkout actúa como agente del sistema).
      registrado_por_id: reserva.registrado_por_id,
      items: {
        create: {
          variante_sku_id: reserva.variante_sku_id,
          cantidad: reserva.cantidad,
          estado_origen: "RESERVADO",
          estado_destino: "DISPONIBLE",
        },
      },
    },
  });
  return true;
}

export interface FiltroLiberacionVencidas {
  depositoId: string;
  skuIds: readonly string[];
}

/**
 * HU-E1 (D4.2) — Libera, dentro del `tx` del llamador, las reservas vencidas
 * (`fecha_expiracion <= ahora`, sin cierre) de los SKU indicados en un
 * depósito. El checkout web la invoca ANTES de reservar, para que una reserva
 * vencida que el job todavía no procesó no le reste stock a una compra nueva
 * (no depende del timing del job). Mismo patrón que `crearReservaTx()`: no abre
 * transacción ni emite eventos; el llamador emite con
 * `emitirReservasLiberadasTtl()` después del commit. Si la transacción del
 * llamador se revierte, la liberación también (el job la hará luego).
 */
export async function liberarReservasVencidasTx(
  tx: Prisma.TransactionClient,
  filtro: FiltroLiberacionVencidas,
  ahora: Date = new Date(),
): Promise<ReservaLiberadaTtl[]> {
  if (filtro.skuIds.length === 0) return [];

  const vencidas = await tx.reserva.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      fecha_fin_reserva: null,
      fecha_expiracion: { lte: ahora },
      deposito_id: filtro.depositoId,
      variante_sku_id: { in: [...filtro.skuIds] },
    },
    select: {
      id: true,
      variante_sku_id: true,
      deposito_id: true,
      cantidad: true,
      registrado_por_id: true,
    },
    orderBy: { fecha_expiracion: "asc" },
  });

  const liberadas: ReservaLiberadaTtl[] = [];
  for (const reserva of vencidas) {
    if (await liberarReservaVencidaTx(tx, reserva, ahora)) {
      liberadas.push({
        reserva_id: reserva.id,
        variante_sku_id: reserva.variante_sku_id,
        cantidad: reserva.cantidad,
      });
    }
  }
  return liberadas;
}

/** Emite `stock:reserva_liberada` (TTL_VENCIDO) por cada reserva liberada con
 * `liberarReservasVencidasTx()`. SIEMPRE fuera de la transacción (spec §4). */
export function emitirReservasLiberadasTtl(liberadas: readonly ReservaLiberadaTtl[]): void {
  for (const reserva of liberadas) {
    domainEventBus.emit("stock:reserva_liberada", {
      reserva_id: reserva.reserva_id,
      motivo_liberacion: "TTL_VENCIDO",
      variante_sku_id: reserva.variante_sku_id,
      cantidad: reserva.cantidad,
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.5 — HU-E2: liberación inmediata por rechazo del pago web
// ──────────────────────────────────────────────────────────────────────────────

/** Motivos de liberación inmediata (no TTL) que acepta `liberarReservasTx()`. */
export type MotivoLiberacionInmediata = "PAGO_RECHAZADO";

/**
 * HU-E2 (CA7) — Libera YA, dentro del `tx` del llamador, las reservas indicadas
 * (RESERVADO → DISPONIBLE), sin mirar `fecha_expiracion`. Mismo núcleo que la
 * liberación por TTL: cierre condicionado + reincremento + `MovimientoStock`
 * INGRESO compensatorio. Las reservas ya cerradas (por el job, D4.2 o una
 * confirmación) se saltean sin error. No emite: el llamador usa
 * `emitirReservasLiberadas()` después del commit.
 */
export async function liberarReservasTx(
  tx: Prisma.TransactionClient,
  reservaIds: readonly string[],
  motivo: MotivoLiberacionInmediata,
  ahora: Date = new Date(),
): Promise<ReservaLiberadaTtl[]> {
  if (reservaIds.length === 0) return [];

  const activas = await tx.reserva.findMany({
    where: { id: { in: [...reservaIds] }, is_active: true, deleted_at: null, fecha_fin_reserva: null },
    select: { id: true, variante_sku_id: true, deposito_id: true, cantidad: true, registrado_por_id: true },
    orderBy: { id: "asc" },
  });

  const liberadas: ReservaLiberadaTtl[] = [];
  for (const reserva of activas) {
    if (await liberarReservaVencidaTx(tx, reserva, ahora, `LIBERACION-${motivo}`)) {
      liberadas.push({ reserva_id: reserva.id, variante_sku_id: reserva.variante_sku_id, cantidad: reserva.cantidad });
    }
  }
  return liberadas;
}

/** Emite `stock:reserva_liberada` por cada reserva liberada, con su motivo.
 * SIEMPRE fuera de la transacción (spec §4). */
export function emitirReservasLiberadas(
  liberadas: readonly ReservaLiberadaTtl[],
  motivo: ReservaLiberadaPayload["motivo_liberacion"],
): void {
  for (const reserva of liberadas) {
    domainEventBus.emit("stock:reserva_liberada", {
      reserva_id: reserva.reserva_id,
      motivo_liberacion: motivo,
      variante_sku_id: reserva.variante_sku_id,
      cantidad: reserva.cantidad,
    });
  }
}
