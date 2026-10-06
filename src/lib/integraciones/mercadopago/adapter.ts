/**
 * Adapter del Conector de Mercado Pago (spec_modulo_F.md §3.1, RULES.md §4).
 * ÚNICO punto del sistema que conoce la API de Mercado Pago: el resto del
 * dominio usa los tipos de `tipos.ts`.
 *
 * HTTP directo con `fetch` contra la API REST (task HU-E2 D-E2-4, desviación
 * §3.4.5: sin SDK npm), con timeout y errores mapeados a `ServiceError`:
 *   PASARELA_TIMEOUT (timeout/red) · PASARELA_NO_DISPONIBLE (5xx/429) ·
 *   PASARELA_RECHAZO_CREDENCIALES (401/403) · PAGO_NO_ENCONTRADO (404 al
 *   consultar) · PASARELA_RESPUESTA_INVALIDA (otro 4xx o JSON inesperado) ·
 *   CONECTOR_NO_CONFIGURADO (sin Conector ACTIVO).
 * Cada llamada queda en la bitácora `InvocacionConectorPago` (sin datos del pago).
 *
 * Checkout Pro (P15): `iniciarCobro` crea una preferencia con UNA línea por el
 * total del pedido (D-E2-1), vencimiento = vencimiento de la reserva y sin
 * medios offline (HU-E1 §14.4). Ningún dato de tarjeta pasa por SWAT (CA1).
 *
 * Con `MP_MODO=simulado` (solo desarrollo) responde desde `simulador.ts`.
 *
 * HU-F1 completó el Adapter: `solicitarReembolso()` (contrato de consumo de
 * HU-E13) y `healthCheck()` (verificación de bajo costo del Conector). Las
 * ramas simuladas de ambas viven acá (nunca en `simulador.ts`).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { ServiceError } from "@/lib/errors/service-error";
import { obtenerConectorActivo, registrarInvocacion, type OperacionConector } from "./conector";
import { obtenerPagoSimulado, simuladorActivo } from "./simulador";
import type {
  CobroIniciado,
  EstadoPagoDominio,
  EstadoReembolsoDominio,
  IniciarCobroInput,
  PagoConsultado,
  ReembolsoSolicitado,
} from "./tipos";

const API_BASE = "https://api.mercadopago.com";
const TIMEOUT_MS = 10_000;

/**
 * Mapeo `status` HTTP → código de `ServiceError` (spec F §3.1). El `404` se
 * traduce a `PAGO_NO_ENCONTRADO` tanto al consultar como al reembolsar
 * (HU-F1). Puro y exportado para poder verificarse sin DB ni red.
 */
export function codigoErrorPorStatus(status: number, operacion: OperacionConector): string {
  if (status === 401 || status === 403) return "PASARELA_RECHAZO_CREDENCIALES";
  if (status === 404 && (operacion === "CONSULTAR_PAGO" || operacion === "SOLICITAR_REEMBOLSO")) {
    return "PAGO_NO_ENCONTRADO";
  }
  if (status >= 500 || status === 429) return "PASARELA_NO_DISPONIBLE";
  return "PASARELA_RESPUESTA_INVALIDA";
}

const MENSAJE_POR_CODIGO: Record<string, string> = {
  PASARELA_RECHAZO_CREDENCIALES: "Mercado Pago rechazó las credenciales del Conector",
  PAGO_NO_ENCONTRADO: "Mercado Pago no encontró el pago informado",
  PASARELA_NO_DISPONIBLE: "Mercado Pago no está disponible",
};

/** Mapeo `status` de MP → estado de dominio (HU-E2 P11: los intermedios no transicionan). */
export function mapearEstadoPago(statusMp: string): EstadoPagoDominio {
  if (statusMp === "approved") return "APROBADO";
  if (statusMp === "rejected" || statusMp === "cancelled") return "RECHAZADO";
  return "PENDIENTE";
}

/** Credenciales explícitas para llamar a MP sin depender del Conector ACTIVO (HU-F1). */
export interface ContextoConector {
  conectorId: string;
  accessToken: string;
}

async function llamarMercadoPago(
  operacion: OperacionConector,
  metodo: "GET" | "POST" | "PUT",
  ruta: string,
  body?: unknown,
  ctx?: ContextoConector,
): Promise<unknown> {
  const conector = ctx
    ? { id: ctx.conectorId, access_token: ctx.accessToken }
    : await obtenerConectorActivo();
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  let respuesta: Response;
  try {
    respuesta = await fetch(`${API_BASE}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${conector.access_token}`,
        "Content-Type": "application/json",
        ...(metodo === "POST" ? { "X-Idempotency-Key": randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controlador.signal,
      cache: "no-store",
    });
  } catch (error) {
    const esTimeout = error instanceof Error && error.name === "AbortError";
    await registrarInvocacion(conector.id, operacion, false, esTimeout ? "timeout" : "error de red");
    throw new ServiceError("PASARELA_TIMEOUT", "Mercado Pago no respondió a tiempo");
  } finally {
    clearTimeout(temporizador);
  }

  if (!respuesta.ok) {
    await registrarInvocacion(conector.id, operacion, false, `HTTP ${respuesta.status}`);
    const codigo = codigoErrorPorStatus(respuesta.status, operacion);
    throw new ServiceError(
      codigo,
      MENSAJE_POR_CODIGO[codigo] ?? `Mercado Pago respondió HTTP ${respuesta.status}`,
    );
  }

  try {
    const json: unknown = await respuesta.json();
    await registrarInvocacion(conector.id, operacion, true);
    return json;
  } catch {
    await registrarInvocacion(conector.id, operacion, false, "JSON inválido");
    throw new ServiceError("PASARELA_RESPUESTA_INVALIDA", "Respuesta de Mercado Pago ilegible");
  }
}

function campoTexto(objeto: Record<string, unknown>, campo: string): string | null {
  const valor = objeto[campo];
  if (typeof valor === "string") return valor;
  if (typeof valor === "number") return String(valor);
  return null;
}

/** Crea la preferencia de Checkout Pro del pedido (spec F §3.1 `iniciarCobro`). */
export async function iniciarCobro(input: IniciarCobroInput): Promise<CobroIniciado> {
  if (simuladorActivo()) {
    const preferenceId = `SIM-PREF-${randomUUID()}`;
    return {
      preference_id: preferenceId,
      checkout_url: `${input.back_urls.pending}&simulado=1&preference_id=${preferenceId}`,
    };
  }

  const json = (await llamarMercadoPago("INICIAR_COBRO", "POST", "/checkout/preferences", {
    items: [
      {
        id: input.external_reference,
        title: input.titulo,
        quantity: 1,
        unit_price: input.monto,
        currency_id: input.moneda,
      },
    ],
    external_reference: input.external_reference,
    notification_url: input.notification_url,
    back_urls: input.back_urls,
    auto_return: "approved",
    binary_mode: true,
    expires: true,
    expiration_date_to: input.expiracion.toISOString(),
    // Sin medios offline (Rapipago, Pago Fácil, cajeros): pueden aprobarse días después.
    payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
    statement_descriptor: "SWAT INDUMENTARIAS",
  })) as Record<string, unknown>;

  const preferenceId = campoTexto(json, "id");
  const checkoutUrl = campoTexto(json, "init_point");
  if (!preferenceId || !checkoutUrl) {
    throw new ServiceError("PASARELA_RESPUESTA_INVALIDA", "La preferencia de Mercado Pago no trae id/init_point");
  }
  return { preference_id: preferenceId, checkout_url: checkoutUrl };
}

/** Estado real del pago según la API de MP (spec F §3.1 `consultarPago`). Nunca se confía en el body del webhook. */
export async function consultarPago(paymentId: string): Promise<PagoConsultado> {
  let json: Record<string, unknown>;
  if (simuladorActivo()) {
    const simulado = obtenerPagoSimulado(paymentId);
    if (!simulado) throw new ServiceError("PAGO_NO_ENCONTRADO", "Pago simulado inexistente");
    json = { ...simulado };
  } else {
    json = (await llamarMercadoPago(
      "CONSULTAR_PAGO",
      "GET",
      `/v1/payments/${encodeURIComponent(paymentId)}`,
    )) as Record<string, unknown>;
  }

  const id = campoTexto(json, "id");
  const status = campoTexto(json, "status");
  const monto = json.transaction_amount;
  if (!id || !status || typeof monto !== "number") {
    throw new ServiceError("PASARELA_RESPUESTA_INVALIDA", "El pago de Mercado Pago no trae id/status/monto");
  }
  return {
    payment_id: id,
    estado: mapearEstadoPago(status),
    status_mp: status,
    status_detail: campoTexto(json, "status_detail") ?? "",
    monto,
    moneda: campoTexto(json, "currency_id") ?? "",
    external_reference: campoTexto(json, "external_reference"),
    fecha_aprobacion: campoTexto(json, "date_approved"),
  };
}

/**
 * HU-E2 (Q2) — Cierra la preferencia para que no admita otro intento de pago
 * después de un rechazo (`expiration_date_to = ahora`). Best-effort: el
 * llamador ignora el error (la regla PAGO_TARDIO cubre el caso).
 */
export async function cerrarCobro(preferenceId: string): Promise<void> {
  if (simuladorActivo()) return;
  await llamarMercadoPago("CERRAR_COBRO", "PUT", `/checkout/preferences/${encodeURIComponent(preferenceId)}`, {
    expires: true,
    expiration_date_to: new Date().toISOString(),
  });
}

/** Mapeo `status` de MP → estado de dominio del reembolso (HU-F1 R1). */
export function mapearEstadoReembolso(statusMp: string): EstadoReembolsoDominio {
  if (statusMp === "approved") return "APROBADO";
  if (statusMp === "rejected" || statusMp === "cancelled") return "RECHAZADO";
  return "PENDIENTE";
}

/**
 * Solicita el reembolso total o parcial de un pago (task HU-F1 R1). Es el
 * contrato de consumo de HU-E13 (cancelación de pedido pagado): devuelve un
 * `ReembolsoSolicitado` con `{ refund_id, payment_id, monto, estado }` — sin
 * datos de tarjeta.
 *
 * Errores posibles (mapeados a `ServiceError`): `PAGO_NO_ENCONTRADO` (404, el
 * pago no existe en MP), `PASARELA_RECHAZO_CREDENCIALES` (401/403),
 * `PASARELA_NO_DISPONIBLE` (5xx/429), `PASARELA_TIMEOUT` (red/timeout) y
 * `PASARELA_RESPUESTA_INVALIDA` (otro 4xx o JSON inesperado).
 *
 * @param paymentId - `payment_id` de Mercado Pago a reembolsar.
 * @param monto - Monto parcial; si se omite, el reembolso es total (MP usa el
 *                total del pago). El body `{ amount }` viaja solo si es parcial.
 */
export async function solicitarReembolso(paymentId: string, monto?: number): Promise<ReembolsoSolicitado> {
  let json: Record<string, unknown>;

  if (simuladorActivo()) {
    let amount = monto;
    if (amount === undefined) {
      const pago = obtenerPagoSimulado(paymentId);
      if (!pago) throw new ServiceError("PAGO_NO_ENCONTRADO", "Pago simulado inexistente");
      amount = pago.transaction_amount;
    }
    json = { id: `SIM-REF-${paymentId}`, payment_id: paymentId, amount, status: "approved" };
  } else {
    json = (await llamarMercadoPago(
      "SOLICITAR_REEMBOLSO",
      "POST",
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      monto === undefined ? undefined : { amount: monto },
    )) as Record<string, unknown>;
  }

  const refundId = campoTexto(json, "id");
  const status = campoTexto(json, "status");
  const amount = json.amount;
  if (!refundId || !status || typeof amount !== "number") {
    throw new ServiceError("PASARELA_RESPUESTA_INVALIDA", "El reembolso de Mercado Pago no trae id/status/amount");
  }
  return {
    refund_id: refundId,
    payment_id: campoTexto(json, "payment_id") ?? paymentId,
    monto: amount,
    estado: mapearEstadoReembolso(status),
  };
}

/** Credenciales de entrada del `healthCheck` (HU-F1 R3.2). */
export interface HealthCheckInput {
  conectorId: string;
  accessToken: string;
}

/**
 * Verificación de bajo costo contra MP (`GET /v1/payment_methods`), SIEMPRE a
 * través del Adapter (spec F §3.1; el service nunca hace `fetch`). Devuelve
 * `true` si las credenciales responden; `false` si MP las rechaza o no está
 * disponible (la invocación fallida queda registrada por `llamarMercadoPago`).
 *
 * En `MP_MODO=simulado` resuelve de forma determinística: un token vacío o que
 * contenga el marcador `INVALID` simula credenciales rechazadas.
 */
export async function healthCheck(input: HealthCheckInput): Promise<boolean> {
  if (simuladorActivo()) {
    return input.accessToken.trim().length > 0 && !input.accessToken.includes("INVALID");
  }
  try {
    await llamarMercadoPago("HEALTH_CHECK", "GET", "/v1/payment_methods", undefined, {
      conectorId: input.conectorId,
      accessToken: input.accessToken,
    });
    return true;
  } catch {
    // `llamarMercadoPago` ya registró la invocación fallida en la bitácora.
    return false;
  }
}
