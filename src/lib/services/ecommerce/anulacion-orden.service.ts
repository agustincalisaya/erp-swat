/**
 * HU-E7 — Anulación de una orden web no abonada (spec_modulo_E.md §2.7;
 * docs/tasks/task_relos.md D1–D13 y decisiones del Paso 1).
 *
 * Un único núcleo (`anularOrdenTx`) para las dos vías:
 * - Manual: `anularOrdenNoAbonada()` — endpoint del Administrador E-commerce.
 * - Automática: `anularOrdenPorReservaVencida()` — listener de
 *   `stock:reserva_liberada` (`TTL_VENCIDO`), sin pasar por el endpoint (D3).
 *
 * Concurrencia (D9): mismo orden de bloqueo que la confirmación del pago web
 * (`PedidoVenta` FOR UPDATE → transición condicionada de la extensión). Un
 * deadlock con el rechazo del pago (que bloquea en el orden inverso) se
 * reintenta localmente (`40P01` o `P2034`, hasta 3 intentos) y reevalúa el estado.
 *
 * Nunca DELETE (Regla N.° 1): ítems, reservas, aplicación de cupón y
 * transacciones de pago quedan en el historial. Los eventos se emiten después
 * del COMMIT con captura local: un listener que lanza no convierte en error
 * una anulación ya confirmada.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import {
  evaluarAnulabilidad,
  MENSAJE_TRANSICION_INVALIDA_ANULACION,
  MOTIVO_ANULACION_TTL,
  type CaminoAnulacion,
} from "@/lib/services/ecommerce/anulacion-orden.reglas";
import {
  darDeBajaAplicacionCuponTx,
  emitirCuponAplicacionLiberada,
  type AplicacionCuponLiberada,
} from "@/lib/services/ecommerce/cupon.service";
import { obtenerUsuarioCanalWebId } from "@/lib/services/ecommerce/usuario-canal-web";
import {
  emitirReservasLiberadas,
  liberarReservasTx,
  type ReservaLiberadaTtl,
} from "@/lib/services/inventario/reserva.service";
import { anularPedidoVentaTx } from "@/lib/services/ventas/pedido-venta.service";

const TIMEOUT_TRANSACCION_MS = 15_000;

export interface ResultadoAnulacionOrden {
  pedido_venta_id: string;
  estado_ecommerce: "ANULADO";
  /** D11: `true` solo si ESTA operación liberó al menos una reserva. */
  stock_liberado: boolean;
}

function noEncontrado(): ServiceError {
  return new ServiceError("PEDIDO_WEB_NO_ENCONTRADO", "El pedido no existe o no es un pedido web");
}

function transicionInvalida(): ServiceError {
  return new ServiceError("TRANSICION_INVALIDA", MENSAJE_TRANSICION_INVALIDA_ANULACION);
}

/**
 * Publica un evento post-COMMIT sin propagar un throw síncrono de un listener
 * (copia local del helper privado de HU-E2, decisión 9 del Paso 1). El log
 * solo lleva el evento, el pedido y el tipo de error: nunca el mensaje ni PII.
 */
function emitirPostCommitSeguroE7<K extends keyof DomainEventMap>(
  evento: K,
  payload: DomainEventMap[K] | (() => void),
  pedidoVentaId: string,
): void {
  try {
    if (typeof payload === "function") payload();
    else domainEventBus.emit(evento, payload);
  } catch (error) {
    console.error(`[HU-E7] Falló la publicación post-commit de ${String(evento)}:`, {
      pedido_venta_id: pedidoVentaId,
      tipo_error: error instanceof Error ? error.name : "desconocido",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Núcleo compartido (manual y automático)
// ──────────────────────────────────────────────────────────────────────────────

interface ActorAnulacion {
  /** `deleted_by` de las bajas lógicas: el usuario de la sesión o "Canal Web". */
  deletedBy: string;
  /** `usuario_id` del evento: solo en la vía manual (D10). */
  usuarioId?: string;
  automatico: boolean;
}

interface AnulacionConfirmada {
  resultado: ResultadoAnulacionOrden;
  liberadas: ReservaLiberadaTtl[];
  cuponLiberado: AplicacionCuponLiberada | null;
  canalWebId: string | null;
}

async function anularOrdenTx(
  tx: Prisma.TransactionClient,
  pedidoVentaId: string,
  deletionReason: string,
  actor: ActorAnulacion,
  caminosPermitidos: readonly CaminoAnulacion[],
): Promise<AnulacionConfirmada> {
  const ahora = new Date();

  // (0) Lock de PedidoVenta PRIMERO, mismo orden que la confirmación del pago
  //     (D9). Sin filtrar por is_active: un PAGO_RECHAZADO ya tiene el
  //     PedidoVenta dado de baja y una segunda anulación debe dar 409 (D7).
  await tx.$queryRaw`SELECT id FROM pedidos_venta WHERE id = ${pedidoVentaId} FOR UPDATE`;

  // (1) Lectura con el lock tomado, sin filtrar por is_active (D7).
  const pedido = await tx.pedidoVenta.findUnique({
    where: { id: pedidoVentaId },
    select: {
      id: true,
      canal: true,
      estado: true,
      is_active: true,
      ecommerce: { select: { id: true, estado_ecommerce: true, cupon_aplicacion_id: true } },
      items: { where: { is_active: true, deleted_at: null }, select: { reserva_id: true } },
    },
  });
  if (!pedido || pedido.canal !== "WEB" || !pedido.ecommerce) throw noEncontrado();

  // (2) Solo PAGO_PENDIENTE / PAGO_RECHAZADO (D4).
  const anulabilidad = evaluarAnulabilidad(pedido.ecommerce.estado_ecommerce);
  if (!anulabilidad.anulable || !caminosPermitidos.includes(anulabilidad.camino)) throw transicionInvalida();
  const camino = anulabilidad.camino;

  // (3) Transición condicionada de la extensión (D9): si el pago ganó la
  //     carrera, el estado ya no coincide → count 0 → 409.
  const transicion = await tx.pedidoVentaEcommerce.updateMany({
    where: { id: pedido.ecommerce.id, estado_ecommerce: camino, is_active: true, deleted_at: null },
    data: {
      estado_ecommerce: "ANULADO",
      is_active: false,
      deleted_at: ahora,
      deleted_by: actor.deletedBy,
      deletion_reason: deletionReason,
    },
  });
  if (transicion.count === 0) throw transicionInvalida();

  let liberadas: ReservaLiberadaTtl[] = [];
  let cuponLiberado: AplicacionCuponLiberada | null = null;
  let canalWebId: string | null = null;

  if (camino === "PAGO_PENDIENTE") {
    // (a) D5: liberación de Módulo A de TODAS las reservas del pedido que sigan
    //     activas (las ya cerradas por el TTL se saltean).
    const reservaIds = pedido.items.map((i) => i.reserva_id).filter((id): id is string => id !== null);
    liberadas = await liberarReservasTx(tx, reservaIds, "ANULACION_ORDEN", ahora);

    // (b) La aplicación pendiente deja de ocupar capacidad del cupón (HU-E4).
    //     Liberación de sistema "Canal Web", mismo actor que el resto de las
    //     liberaciones automáticas de E4 (spec E §4 Rev.3).
    if (pedido.ecommerce.cupon_aplicacion_id) {
      canalWebId = await obtenerUsuarioCanalWebId(tx);
      cuponLiberado = await darDeBajaAplicacionCuponTx(tx, pedido.ecommerce.cupon_aplicacion_id, {
        deleted_by: canalWebId,
        deletion_reason: deletionReason,
        ahora,
      });
    }
  }

  // (c) PedidoVenta RESERVADO → ANULADO con baja lógica. En PAGO_RECHAZADO,
  //     E2 ya lo anuló: solo se anula si sigue RESERVADO y activo (decisión 1
  //     del Paso 1), sin pisar la baja que dejó E2.
  if (camino === "PAGO_PENDIENTE" || (pedido.estado === "RESERVADO" && pedido.is_active)) {
    try {
      await anularPedidoVentaTx(tx, {
        pedido_venta_id: pedido.id,
        deleted_by: actor.deletedBy,
        deletion_reason: deletionReason,
        ahora,
      });
    } catch (error) {
      if (error instanceof ServiceError && error.code === "TRANSICION_INVALIDA") throw transicionInvalida();
      throw error;
    }
  }

  return {
    resultado: { pedido_venta_id: pedido.id, estado_ecommerce: "ANULADO", stock_liberado: liberadas.length > 0 },
    liberadas,
    cuponLiberado,
    canalWebId,
  };
}

const INTENTOS_ANULACION = 3;

/**
 * Conflicto de concurrencia reintentable: deadlock de PostgreSQL (`40P01`, que
 * Prisma informa como `PrismaClientUnknownRequestError`) o `P2034`. El
 * rechazo del pago web bloquea extensión → PedidoVenta, el orden inverso al
 * de la anulación (decisión del Paso 2: reintento local, sin tocar
 * `ejecutarConReintentoDeConflicto`, que no cubre `40P01`).
 */
function esConflictoReintentable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
  return error instanceof Prisma.PrismaClientUnknownRequestError && /\b40P01\b/.test(error.message);
}

/** Hasta 3 intentos; cada uno relee el estado de la orden (otro camino si cambió). */
async function ejecutarConReintentoDeadlock<T>(pedidoVentaId: string, operacion: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await operacion();
    } catch (error) {
      if (!esConflictoReintentable(error) || intento >= INTENTOS_ANULACION) throw error;
      console.warn("[HU-E7] Reintento de la anulación por conflicto de concurrencia:", {
        pedido_venta_id: pedidoVentaId,
        intento,
      });
    }
  }
}

async function ejecutarAnulacion(
  pedidoVentaId: string,
  deletionReason: string,
  actor: ActorAnulacion,
  caminosPermitidos: readonly CaminoAnulacion[],
): Promise<ResultadoAnulacionOrden> {
  const confirmada = await ejecutarConReintentoDeadlock(pedidoVentaId, () =>
    prisma.$transaction((tx) => anularOrdenTx(tx, pedidoVentaId, deletionReason, actor, caminosPermitidos), {
      timeout: TIMEOUT_TRANSACCION_MS,
    }),
  );

  // Post-COMMIT, cada emisión aislada (spec §4). Una sola vez, tras el intento
  // que confirmó; si todos fallaron, la excepción ya cortó y no se emite nada.
  if (confirmada.liberadas.length > 0) {
    emitirPostCommitSeguroE7(
      "stock:reserva_liberada",
      () => emitirReservasLiberadas(confirmada.liberadas, "ANULACION_ORDEN"),
      pedidoVentaId,
    );
  }
  const { cuponLiberado, canalWebId } = confirmada;
  if (cuponLiberado && canalWebId) {
    emitirPostCommitSeguroE7(
      "ecommerce:cupon_aplicacion_liberada",
      () => emitirCuponAplicacionLiberada(cuponLiberado, canalWebId),
      pedidoVentaId,
    );
  }
  emitirPostCommitSeguroE7(
    "ecommerce:orden_anulada",
    {
      pedido_venta_id: pedidoVentaId,
      ...(actor.usuarioId ? { usuario_id: actor.usuarioId } : {}),
      deletion_reason: deletionReason,
      automatico: actor.automatico,
    },
    pedidoVentaId,
  );

  return confirmada.resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// Vía manual (endpoint)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Anulación manual por el Administrador E-commerce. `actorId` sale siempre de
 * la sesión (D12).
 *
 * @throws {ServiceError} PEDIDO_WEB_NO_ENCONTRADO (404) | TRANSICION_INVALIDA (409)
 */
export async function anularOrdenNoAbonada(
  pedidoVentaId: string,
  actorId: string,
  deletionReason: string,
): Promise<ResultadoAnulacionOrden> {
  return ejecutarAnulacion(
    pedidoVentaId,
    deletionReason,
    { deletedBy: actorId, usuarioId: actorId, automatico: false },
    ["PAGO_PENDIENTE", "PAGO_RECHAZADO"],
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Vía automática (listener de stock:reserva_liberada, TTL_VENCIDO)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * D3: correlaciona `reserva_id` → ítem → `PedidoVenta` y, si es canal WEB con
 * la extensión activa en PAGO_PENDIENTE, aplica el mismo núcleo que la vía
 * manual (actor "Canal Web", `MOTIVO_ANULACION_TTL`, `automatico: true`).
 * Cualquier otro caso (otra orden, mostrador, otro estado, ya anulada por otra
 * reserva de la misma orden) devuelve `null` sin error.
 */
export async function anularOrdenPorReservaVencida(reservaId: string): Promise<ResultadoAnulacionOrden | null> {
  const item = await prisma.pedidoVentaItem.findUnique({
    where: { reserva_id: reservaId },
    select: {
      pedido_venta: {
        select: { id: true, canal: true, ecommerce: { select: { estado_ecommerce: true, is_active: true } } },
      },
    },
  });
  const pedido = item?.pedido_venta;
  if (!pedido || pedido.canal !== "WEB" || !pedido.ecommerce?.is_active) return null;
  if (pedido.ecommerce.estado_ecommerce !== "PAGO_PENDIENTE") return null;

  const canalWebId = await obtenerUsuarioCanalWebId();
  try {
    return await ejecutarAnulacion(
      pedido.id,
      MOTIVO_ANULACION_TTL,
      { deletedBy: canalWebId, automatico: true },
      ["PAGO_PENDIENTE"],
    );
  } catch (error) {
    // Otra reserva de la misma orden (o el pago) ganó: no hay nada que hacer.
    if (error instanceof ServiceError && (error.code === "TRANSICION_INVALIDA" || error.code === "PEDIDO_WEB_NO_ENCONTRADO")) {
      return null;
    }
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Listado para la pantalla /ecommerce/pedidos (solo lectura)
// ──────────────────────────────────────────────────────────────────────────────

export const PAGE_SIZE_ORDENES_NO_ABONADAS = 20;

export interface OrdenNoAbonadaFila {
  pedido_venta_id: string;
  numero_venta: string;
  /** Solo el nombre: sin email, DNI ni teléfono. */
  cliente_nombre: string | null;
  /** Decimal como string, 2 decimales. */
  total: string;
  estado_ecommerce: "PAGO_PENDIENTE" | "PAGO_RECHAZADO";
  created_at: string;
}

export interface OrdenesNoAbonadasPagina {
  items: OrdenNoAbonadaFila[];
  total: number;
  page: number;
  page_size: number;
}

const ORDEN_NO_ABONADA = {
  is_active: true,
  deleted_at: null,
  estado_ecommerce: { in: ["PAGO_PENDIENTE", "PAGO_RECHAZADO"] },
} satisfies Prisma.PedidoVentaEcommerceWhereInput;

export async function listarOrdenesNoAbonadasAdmin(
  opciones: { page?: number; page_size?: number } = {},
): Promise<OrdenesNoAbonadasPagina> {
  const page = Math.max(1, Math.trunc(opciones.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(opciones.page_size ?? PAGE_SIZE_ORDENES_NO_ABONADAS)));
  const [total, filas] = await Promise.all([
    prisma.pedidoVentaEcommerce.count({ where: ORDEN_NO_ABONADA }),
    prisma.pedidoVentaEcommerce.findMany({
      where: ORDEN_NO_ABONADA,
      orderBy: [{ created_at: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        estado_ecommerce: true,
        created_at: true,
        pedido_venta: { select: { id: true, numero_venta: true, total: true, cliente: { select: { nombre: true } } } },
      },
    }),
  ]);
  return {
    items: filas.map((f) => ({
      pedido_venta_id: f.pedido_venta.id,
      numero_venta: f.pedido_venta.numero_venta,
      cliente_nombre: f.pedido_venta.cliente?.nombre ?? null,
      total: f.pedido_venta.total.toFixed(2),
      estado_ecommerce: f.estado_ecommerce as OrdenNoAbonadaFila["estado_ecommerce"],
      created_at: f.created_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}
