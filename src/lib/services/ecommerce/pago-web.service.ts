/**
 * HU-E2 — Pago online con Mercado Pago (spec_modulo_E.md §2.2; decisiones en
 * docs/tasks/HU-E2.md §3.2, orden de operaciones en §9.4).
 *
 * - `obtenerOCrearPreferencia()`: UNA preferencia de Checkout Pro por pedido
 *   (`external_reference = PedidoVentaEcommerce.id`), creada FUERA de toda
 *   transacción y guardada con `UPDATE … WHERE mercadopago_preference_id IS NULL`.
 * - `procesarNotificacionPago()`: lo invoca el webhook SÍNCRONAMENTE (P12). El
 *   estado, monto y referencia salen SIEMPRE de `consultarPago()` (API de MP),
 *   nunca del body. El pedido se resuelve SOLO por `external_reference`.
 *
 * Idempotencia: por TRANSICIÓN condicionada (`… WHERE estado_ecommerce =
 * 'PAGO_PENDIENTE'`) como primera sentencia de cada transacción — toma el lock
 * de la fila y serializa notificaciones concurrentes del mismo pedido; la
 * segunda ve `count = 0` y no hace nada. `mercadopago_payment_id @unique` es la
 * segunda guarda. Eventos SIEMPRE post-commit (sin outbox: riesgo R8).
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { MotivoPagoAnomalo, PagoAnomaloPayload, ReservaLiberadaPayload } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import { cerrarCobro, consultarPago, iniciarCobro } from "@/lib/integraciones/mercadopago/adapter";
import type { PagoConsultado } from "@/lib/integraciones/mercadopago/tipos";
import { reconstruirCarritoDesdePedidoTx } from "@/lib/services/ecommerce/carrito.service";
import {
  confirmarAplicacionCuponTx,
  darDeBajaAplicacionCuponTx,
  emitirCuponAplicacionLiberada,
  emitirCuponConsumido,
} from "@/lib/services/ecommerce/cupon.service";
import {
  clasificarAprobadoSobreResuelto,
  esReferenciaValida,
  MONEDA_CANAL_WEB,
  pagoCoincideConPedido,
  reservasVigentesParaConfirmar,
  type ResultadoNotificacion,
} from "@/lib/services/ecommerce/pago-web.reglas";
import { obtenerUsuarioCanalWebId } from "@/lib/services/ecommerce/usuario-canal-web";
import {
  confirmarReservaPorVentaTx,
  emitirReservasLiberadas,
  liberarReservasTx,
} from "@/lib/services/inventario/reserva.service";
import { emitirComprobanteFiscal } from "@/lib/services/ventas/comprobante-fiscal.service";
import { anularPedidoVentaTx, facturarPedidoVentaTx } from "@/lib/services/ventas/pedido-venta.service";

const TIMEOUT_TRANSACCION_MS = 15_000;

// ──────────────────────────────────────────────────────────────────────────────
// Preferencia de Checkout Pro
// ──────────────────────────────────────────────────────────────────────────────

/** Base pública para `notification_url`/`back_urls` (P16). */
function urlPublica(): string {
  const base = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    throw new ServiceError("APP_PUBLIC_URL_NO_CONFIGURADA", "Falta APP_PUBLIC_URL para generar el pago online");
  }
  return base;
}

/**
 * `checkout_url` del pedido: la guardada, o una preferencia nueva si el pedido
 * sigue PAGO_PENDIENTE con reservas vigentes. `null` si ya no se puede pagar.
 * La preferencia vence junto con la reserva (`expiration_date_to`, Q2).
 *
 * @throws {ServiceError} APP_PUBLIC_URL_NO_CONFIGURADA | PASARELA_* | CONECTOR_NO_CONFIGURADO
 */
export async function obtenerOCrearPreferencia(pedidoVentaEcommerceId: string): Promise<string | null> {
  const pedido = await prisma.pedidoVentaEcommerce.findFirst({
    where: { id: pedidoVentaEcommerceId, is_active: true, deleted_at: null },
    select: {
      estado_ecommerce: true,
      mercadopago_checkout_url: true,
      pedido_venta: {
        select: {
          id: true,
          numero_venta: true,
          total: true,
          items: {
            where: { is_active: true, deleted_at: null },
            select: { reserva: { select: { fecha_expiracion: true, fecha_fin_reserva: true } } },
          },
        },
      },
    },
  });
  if (!pedido || pedido.estado_ecommerce !== "PAGO_PENDIENTE") return null;
  if (pedido.mercadopago_checkout_url) return pedido.mercadopago_checkout_url;

  const reservas = pedido.pedido_venta.items.map((i) => i.reserva);
  const ahora = new Date();
  if (!reservasVigentesParaConfirmar(reservas, ahora)) return null;
  const expiracion = new Date(Math.min(...reservas.map((r) => r!.fecha_expiracion.getTime())));

  const base = urlPublica();
  const retorno = `${base}/tienda/checkout/resultado?pedido=${pedido.pedido_venta.id}`;
  const cobro = await iniciarCobro({
    external_reference: pedidoVentaEcommerceId,
    titulo: `Pedido ${pedido.pedido_venta.numero_venta} — SWAT Indumentarias`,
    monto: pedido.pedido_venta.total.toNumber(),
    moneda: MONEDA_CANAL_WEB,
    expiracion,
    notification_url: `${base}/api/webhooks/mercadopago`,
    back_urls: { success: retorno, failure: retorno, pending: retorno },
  });

  // Una sola preferencia por pedido: si otra request ganó la carrera, se usa la suya.
  const guardado = await prisma.pedidoVentaEcommerce.updateMany({
    where: { id: pedidoVentaEcommerceId, mercadopago_preference_id: null },
    data: { mercadopago_preference_id: cobro.preference_id, mercadopago_checkout_url: cobro.checkout_url },
  });
  if (guardado.count === 1) return cobro.checkout_url;
  const ganador = await prisma.pedidoVentaEcommerce.findUnique({
    where: { id: pedidoVentaEcommerceId },
    select: { mercadopago_checkout_url: true },
  });
  return ganador?.mercadopago_checkout_url ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Notificación de pago (webhook)
// ──────────────────────────────────────────────────────────────────────────────

/** Dependencias externas, inyectables en tests (sin red). */
export interface PasarelaPagos {
  consultarPago: (paymentId: string) => Promise<PagoConsultado>;
  cerrarCobro: (preferenceId: string) => Promise<void>;
}

const PASARELA_REAL: PasarelaPagos = { consultarPago, cerrarCobro };

export interface ResultadoProcesamientoPago {
  resultado: ResultadoNotificacion;
  motivo?: MotivoPagoAnomalo;
  pedido_venta_id?: string;
}

/** Error interno: corta la transacción y la revierte (no sale de este archivo). */
class AbortoPago extends Error {
  constructor(
    readonly tipo: "NO_PENDIENTE" | MotivoPagoAnomalo,
    readonly pedidoVentaId: string | null = null,
    readonly montoEsperado: number | null = null,
  ) {
    super(tipo);
  }
}

function emitirAnomalo(
  motivo: MotivoPagoAnomalo,
  pago: PagoConsultado,
  pedido: { ecommerce_id: string | null; venta_id: string | null; monto_esperado: number | null },
): ResultadoProcesamientoPago {
  const payload: PagoAnomaloPayload = {
    motivo,
    mercadopago_payment_id: pago.payment_id,
    estado_pago_mp: pago.status_mp,
    pedido_venta_ecommerce_id: pedido.ecommerce_id,
    pedido_venta_id: pedido.venta_id,
    monto_informado: pago.monto,
    moneda_informada: pago.moneda,
    monto_esperado: pedido.monto_esperado,
  };
  domainEventBus.emit("ecommerce:pago_anomalo", payload);
  return { resultado: "ANOMALIA", motivo, pedido_venta_id: pedido.venta_id ?? undefined };
}

const esP2002PaymentId = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  JSON.stringify(error.meta?.target ?? "").includes("mercadopago_payment_id");

/**
 * Procesa una notificación de pago ya autenticada por firma (CA2). Consulta el
 * pago a MP y aplica confirmación (CA6), rechazo (CA7) o nada (idempotencia,
 * CA3). Las anomalías NO lanzan: devuelven `ANOMALIA` (el webhook responde 200).
 *
 * @throws {ServiceError} PASARELA_* | CONECTOR_NO_CONFIGURADO — el webhook
 *         responde 500 para que Mercado Pago reintente.
 */
export async function procesarNotificacionPago(
  paymentId: string,
  pasarela: PasarelaPagos = PASARELA_REAL,
): Promise<ResultadoProcesamientoPago> {
  let pago: PagoConsultado;
  try {
    pago = await pasarela.consultarPago(paymentId);
  } catch (error) {
    // Pago inexistente en MP (ej. la notificación de prueba del panel): nada que aplicar.
    if (error instanceof ServiceError && error.code === "PAGO_NO_ENCONTRADO") return { resultado: "SIN_EFECTO" };
    throw error;
  }

  if (pago.estado === "PENDIENTE") return { resultado: "PENDIENTE" };

  if (!esReferenciaValida(pago.external_reference)) {
    return emitirAnomalo("PAGO_HUERFANO", pago, { ecommerce_id: null, venta_id: null, monto_esperado: null });
  }
  const pedido = await prisma.pedidoVentaEcommerce.findUnique({
    where: { id: pago.external_reference },
    select: { id: true, pedido_venta_id: true },
  });
  if (!pedido) {
    return emitirAnomalo("PAGO_HUERFANO", pago, { ecommerce_id: null, venta_id: null, monto_esperado: null });
  }

  return pago.estado === "APROBADO"
    ? confirmarPago(pago, pedido.id, pedido.pedido_venta_id)
    : rechazarPago(pago, pedido.id, pedido.pedido_venta_id, pasarela);
}

// ── Confirmación (CA6) ────────────────────────────────────────────────────────

async function confirmarPago(
  pago: PagoConsultado,
  ecommerceId: string,
  pedidoVentaId: string,
): Promise<ResultadoProcesamientoPago> {
  const usuarioCanalWebId = await obtenerUsuarioCanalWebId();
  const fechaAprobacion = pago.fecha_aprobacion ? new Date(pago.fecha_aprobacion) : new Date();

  let confirmado;
  try {
    confirmado = await prisma.$transaction(
      async (tx) => {
        const ahora = new Date();

        // (1) Transición condicionada PRIMERO: lock de la fila + idempotencia.
        const transicion = await tx.pedidoVentaEcommerce.updateMany({
          where: { id: ecommerceId, estado_ecommerce: "PAGO_PENDIENTE", is_active: true, deleted_at: null },
          data: { estado_ecommerce: "PAGO_CONFIRMADO", mercadopago_payment_id: pago.payment_id },
        });
        if (transicion.count === 0) throw new AbortoPago("NO_PENDIENTE");

        // (2) Datos del pedido con el lock tomado + control de monto (P13).
        const pedido = await tx.pedidoVentaEcommerce.findUniqueOrThrow({
          where: { id: ecommerceId },
          select: {
            cupon_aplicacion_id: true,
            pedido_venta: {
              select: {
                id: true,
                numero_venta: true,
                total: true,
                cliente_id: true,
                items: {
                  where: { is_active: true, deleted_at: null },
                  select: {
                    reserva: { select: { id: true, fecha_expiracion: true, fecha_fin_reserva: true } },
                  },
                },
              },
            },
          },
        });
        const venta = pedido.pedido_venta;
        const total = venta.total;
        if (!pagoCoincideConPedido(total.toString(), pago.monto, pago.moneda)) {
          throw new AbortoPago("MONTO_DISCREPANTE", venta.id, total.toNumber());
        }

        // (3) Reservas vigentes (Q2) → RESERVADO → VENDIDO vía Módulo A.
        const reservas = venta.items.map((i) => i.reserva);
        if (!reservasVigentesParaConfirmar(reservas, ahora)) {
          throw new AbortoPago("PAGO_TARDIO", venta.id, total.toNumber());
        }
        const eventosReserva: ReservaLiberadaPayload[] = [];
        for (const reserva of reservas) {
          try {
            const confirmada = await confirmarReservaPorVentaTx(tx, reserva!.id, venta.id, usuarioCanalWebId, ahora);
            eventosReserva.push(confirmada.evento);
          } catch (error) {
            if (error instanceof ServiceError && error.code === "RESERVA_NO_ACTIVA") {
              throw new AbortoPago("PAGO_TARDIO", venta.id, total.toNumber());
            }
            throw error;
          }
        }

        // (4) PedidoVenta RESERVADO → FACTURADO + cobro MERCADO_PAGO (Módulo B).
        await facturarPedidoVentaTx(tx, {
          pedido_venta_id: venta.id,
          fecha_facturacion: fechaAprobacion,
          medio_pago: { medio: "MERCADO_PAGO", importe: total, referencia: pago.payment_id },
        });

        // (5) Factura B simulada (HU-B7): el cliente web no elige el tipo.
        const comprobante = await emitirComprobanteFiscal(tx, {
          pedido_venta_id: venta.id,
          numero_venta: venta.numero_venta,
          tipo_comprobante: "FACTURA_B",
          monto_total: total.toNumber(),
          emitido_por_id: usuarioCanalWebId,
        });

        // (6) Consumo del cupón (spec §2.4: recién al confirmarse el pago).
        const cupon = pedido.cupon_aplicacion_id
          ? await confirmarAplicacionCuponTx(tx, pedido.cupon_aplicacion_id)
          : { limite_excedido: false, consumo: null };

        const cuenta = venta.cliente_id
          ? await tx.cuentaClienteWeb.findUnique({ where: { cliente_id: venta.cliente_id }, select: { id: true } })
          : null;

        return {
          venta,
          total,
          comprobanteId: comprobante.comprobante_id,
          cuponAplicacionId: pedido.cupon_aplicacion_id,
          cuponExcedido: cupon.limite_excedido,
          cuponConsumo: cupon.consumo,
          cuentaId: cuenta?.id ?? "",
          eventosReserva,
        };
      },
      { timeout: TIMEOUT_TRANSACCION_MS },
    );
  } catch (error) {
    if (error instanceof AbortoPago) {
      if (error.tipo === "NO_PENDIENTE") return resolverAprobadoSobreResuelto(pago, ecommerceId, pedidoVentaId);
      return emitirAnomalo(error.tipo, pago, {
        ecommerce_id: ecommerceId,
        venta_id: error.pedidoVentaId ?? pedidoVentaId,
        monto_esperado: error.montoEsperado,
      });
    }
    if (esP2002PaymentId(error)) {
      return emitirAnomalo("PAGO_DUPLICADO", pago, { ecommerce_id: ecommerceId, venta_id: pedidoVentaId, monto_esperado: null });
    }
    throw error;
  }

  // Post-commit (regla de emisión, spec §4).
  emitirReservasLiberadas(confirmado.eventosReserva, "VENTA");
  domainEventBus.emit("ecommerce:pedido_pago_confirmado", {
    pedido_venta_id: confirmado.venta.id,
    pedido_venta_ecommerce_id: ecommerceId,
    numero_venta: confirmado.venta.numero_venta,
    cliente_id: confirmado.venta.cliente_id ?? "",
    cliente_web_cuenta_id: confirmado.cuentaId,
    mercadopago_payment_id: pago.payment_id,
    monto: confirmado.total.toNumber(),
    moneda: MONEDA_CANAL_WEB,
    fecha_aprobacion: fechaAprobacion.toISOString(),
    comprobante_id: confirmado.comprobanteId,
    cupon_aplicacion_id: confirmado.cuponAplicacionId,
  });
  // HU-E4: consumo del cupón (spec E §4).
  if (confirmado.cuponConsumo) emitirCuponConsumido(confirmado.cuponConsumo, usuarioCanalWebId);
  if (confirmado.cuponExcedido) {
    emitirAnomalo("CUPON_LIMITE_EXCEDIDO", pago, {
      ecommerce_id: ecommerceId,
      venta_id: confirmado.venta.id,
      monto_esperado: confirmado.total.toNumber(),
    });
  }
  return { resultado: "CONFIRMADO", pedido_venta_id: confirmado.venta.id };
}

/** Pago aprobado que encontró el pedido ya resuelto (D-E2-5, Q2). */
async function resolverAprobadoSobreResuelto(
  pago: PagoConsultado,
  ecommerceId: string,
  pedidoVentaId: string,
): Promise<ResultadoProcesamientoPago> {
  const actual = await prisma.pedidoVentaEcommerce.findUnique({
    where: { id: ecommerceId },
    select: { estado_ecommerce: true, mercadopago_payment_id: true, pedido_venta: { select: { total: true } } },
  });
  const clasificacion = clasificarAprobadoSobreResuelto(
    actual?.estado_ecommerce ?? "",
    actual?.mercadopago_payment_id ?? null,
    pago.payment_id,
  );
  if (clasificacion === "SIN_EFECTO") return { resultado: "SIN_EFECTO", pedido_venta_id: pedidoVentaId };
  return emitirAnomalo(clasificacion, pago, {
    ecommerce_id: ecommerceId,
    venta_id: pedidoVentaId,
    monto_esperado: actual?.pedido_venta.total.toNumber() ?? null,
  });
}

// ── Rechazo (CA7) ─────────────────────────────────────────────────────────────

async function rechazarPago(
  pago: PagoConsultado,
  ecommerceId: string,
  pedidoVentaId: string,
  pasarela: PasarelaPagos,
): Promise<ResultadoProcesamientoPago> {
  const usuarioCanalWebId = await obtenerUsuarioCanalWebId();

  let rechazado;
  try {
    rechazado = await prisma.$transaction(
      async (tx) => {
        const ahora = new Date();

        // (1) Transición condicionada: un rechazo sobre un pedido ya resuelto no hace nada.
        const transicion = await tx.pedidoVentaEcommerce.updateMany({
          where: { id: ecommerceId, estado_ecommerce: "PAGO_PENDIENTE", is_active: true, deleted_at: null },
          data: { estado_ecommerce: "PAGO_RECHAZADO", mercadopago_payment_id: pago.payment_id },
        });
        if (transicion.count === 0) throw new AbortoPago("NO_PENDIENTE");

        // (2) Ítems y reservas del pedido.
        const pedido = await tx.pedidoVentaEcommerce.findUniqueOrThrow({
          where: { id: ecommerceId },
          select: {
            cupon_aplicacion_id: true,
            mercadopago_preference_id: true,
            pedido_venta: {
              select: {
                id: true,
                numero_venta: true,
                total: true,
                cliente_id: true,
                items: {
                  where: { is_active: true, deleted_at: null },
                  select: { variante_sku_id: true, cantidad: true, reserva_id: true },
                },
              },
            },
          },
        });
        const venta = pedido.pedido_venta;

        // (3) Liberación inmediata vía Módulo A (las ya cerradas se saltean).
        const reservaIds = venta.items.map((i) => i.reserva_id).filter((id): id is string => id !== null);
        const liberadas = await liberarReservasTx(tx, reservaIds, "PAGO_RECHAZADO", ahora);

        // (4) El cupón no cuenta contra el límite (spec §2.4).
        const cuponLiberado = pedido.cupon_aplicacion_id
          ? await darDeBajaAplicacionCuponTx(tx, pedido.cupon_aplicacion_id, {
              deleted_by: usuarioCanalWebId,
              deletion_reason: "Pago rechazado por Mercado Pago",
              ahora,
            })
          : null;

        // (5) Carrito reconstruido para reintentar con un checkout nuevo (P5).
        const cuenta = venta.cliente_id
          ? await tx.cuentaClienteWeb.findUnique({ where: { cliente_id: venta.cliente_id }, select: { id: true } })
          : null;
        if (!cuenta) throw new ServiceError("CUENTA_WEB_NO_ENCONTRADA", "El pedido web no tiene cuenta de Cliente Web");
        const carrito = await reconstruirCarritoDesdePedidoTx(
          tx,
          cuenta.id,
          venta.items.map((i) => ({ variante_sku_id: i.variante_sku_id, cantidad: i.cantidad })),
        );

        // (6) PedidoVenta RESERVADO → ANULADO con baja lógica (P4 corregido).
        //     El PedidoVentaEcommerce queda PAGO_RECHAZADO y activo (CA7).
        await anularPedidoVentaTx(tx, {
          pedido_venta_id: venta.id,
          deleted_by: usuarioCanalWebId,
          deletion_reason: `Pago rechazado por Mercado Pago (${pago.status_detail || pago.status_mp})`,
          ahora,
        });

        return { venta, cuentaId: cuenta.id, carritoId: carrito.carrito_id, liberadas, preferenceId: pedido.mercadopago_preference_id, cuponLiberado };
      },
      { timeout: TIMEOUT_TRANSACCION_MS },
    );
  } catch (error) {
    if (error instanceof AbortoPago) return { resultado: "SIN_EFECTO", pedido_venta_id: pedidoVentaId };
    if (esP2002PaymentId(error)) {
      return emitirAnomalo("PAGO_DUPLICADO", pago, { ecommerce_id: ecommerceId, venta_id: pedidoVentaId, monto_esperado: null });
    }
    throw error;
  }

  // Post-commit.
  emitirReservasLiberadas(rechazado.liberadas, "PAGO_RECHAZADO");
  domainEventBus.emit("ecommerce:pago_rechazado", {
    pedido_venta_id: rechazado.venta.id,
    pedido_venta_ecommerce_id: ecommerceId,
    numero_venta: rechazado.venta.numero_venta,
    cliente_id: rechazado.venta.cliente_id ?? "",
    cliente_web_cuenta_id: rechazado.cuentaId,
    mercadopago_payment_id: pago.payment_id,
    monto: pago.monto,
    moneda: MONEDA_CANAL_WEB,
    fecha_rechazo: new Date().toISOString(),
    motivo_rechazo: pago.status_detail || pago.status_mp,
    reserva_ids: rechazado.liberadas.map((r) => r.reserva_id),
    carrito_id: rechazado.carritoId,
  });
  // HU-E4: la aplicación del cupón quedó liberada (spec E §4).
  if (rechazado.cuponLiberado) emitirCuponAplicacionLiberada(rechazado.cuponLiberado, usuarioCanalWebId);

  // Q2: la preferencia no debe admitir otro intento. Best-effort: si falla,
  // un pago aprobado posterior cae en PAGO_TARDIO.
  if (rechazado.preferenceId) {
    await pasarela.cerrarCobro(rechazado.preferenceId).catch((error: unknown) => {
      console.error(`[pago-web] No se pudo cerrar la preferencia ${rechazado.preferenceId}:`, error);
    });
  }
  return { resultado: "RECHAZADO", pedido_venta_id: rechazado.venta.id };
}

// ──────────────────────────────────────────────────────────────────────────────
// Página de retorno (back_urls)
// ──────────────────────────────────────────────────────────────────────────────

export interface ResultadoPagoVista {
  pedido_venta_id: string;
  numero_venta: string;
  estado_ecommerce: string;
  total: number;
  /** HU-E4: cupón activo del pedido; `total` es neto, `subtotal` = `total` + `monto_descontado`. */
  cupon: { codigo: string; monto_descontado: number; subtotal: number } | null;
  comprobante: { tipo: string; cae_simulado: string } | null;
}

/**
 * Estado del pedido para la página de retorno de Mercado Pago, leído SIEMPRE
 * de la base (los query params de MP no son confiables). Solo si el pedido es
 * del cliente de la sesión; ajeno o inexistente → `null` (spec E §2.9). Incluye
 * pedidos con `PedidoVenta` ANULADO (pago rechazado): la extensión sigue activa.
 */
export async function obtenerResultadoPago(pedidoVentaId: string, clienteId: string): Promise<ResultadoPagoVista | null> {
  const pedido = await prisma.pedidoVentaEcommerce.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
      pedido_venta: { id: pedidoVentaId, cliente_id: clienteId, canal: "WEB" },
    },
    select: {
      estado_ecommerce: true,
      pedido_venta: {
        select: {
          id: true,
          numero_venta: true,
          total: true,
          comprobantes: {
            orderBy: { created_at: "desc" },
            take: 1,
            select: { tipo_comprobante: true, cae_simulado: true },
          },
          aplicaciones_cupon: {
            where: { is_active: true, deleted_at: null },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { monto_descontado: true, cupon: { select: { codigo: true } } },
          },
        },
      },
    },
  });
  if (!pedido) return null;
  const comprobante = pedido.pedido_venta.comprobantes[0];
  const aplicacion = pedido.pedido_venta.aplicaciones_cupon[0];
  return {
    pedido_venta_id: pedido.pedido_venta.id,
    numero_venta: pedido.pedido_venta.numero_venta,
    estado_ecommerce: pedido.estado_ecommerce,
    total: pedido.pedido_venta.total.toNumber(),
    cupon: aplicacion
      ? {
          codigo: aplicacion.cupon.codigo,
          monto_descontado: aplicacion.monto_descontado.toNumber(),
          subtotal: aplicacion.monto_descontado.add(pedido.pedido_venta.total).toNumber(),
        }
      : null,
    comprobante: comprobante ? { tipo: comprobante.tipo_comprobante, cae_simulado: comprobante.cae_simulado } : null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Traza de notificaciones (WebhookPagoLog, append-only)
// ──────────────────────────────────────────────────────────────────────────────

/** PROVISORIO HU-E2 — completar en HU-F1 (owner: Rama). Nunca hace fallar el webhook. */
export async function registrarTrazaWebhook(
  paymentId: string,
  topic: string,
  requestId: string | null,
  resultado: ResultadoNotificacion | "ERROR",
): Promise<void> {
  try {
    await prisma.webhookPagoLog.create({
      data: { mercadopago_payment_id: paymentId, topic, request_id: requestId, resultado },
    });
  } catch (error) {
    console.error("[pago-web] No se pudo registrar la traza del webhook:", error);
  }
}
