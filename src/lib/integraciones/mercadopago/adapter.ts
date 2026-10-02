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
 * // PROVISORIO HU-E2 — completar en HU-F1 (owner: Rama): falta
 * // `solicitarReembolso()`; `cerrarCobro()` no está en spec F §3.1 (task Q2).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { ServiceError } from "@/lib/errors/service-error";
import { obtenerConectorActivo, registrarInvocacion, type OperacionConector } from "./conector";
import { obtenerPagoSimulado, simuladorActivo } from "./simulador";
import type { CobroIniciado, EstadoPagoDominio, IniciarCobroInput, PagoConsultado } from "./tipos";

const API_BASE = "https://api.mercadopago.com";
const TIMEOUT_MS = 10_000;

/** Mapeo `status` de MP → estado de dominio (HU-E2 P11: los intermedios no transicionan). */
export function mapearEstadoPago(statusMp: string): EstadoPagoDominio {
  if (statusMp === "approved") return "APROBADO";
  if (statusMp === "rejected" || statusMp === "cancelled") return "RECHAZADO";
  return "PENDIENTE";
}

async function llamarMercadoPago(
  operacion: OperacionConector,
  metodo: "GET" | "POST" | "PUT",
  ruta: string,
  body?: unknown,
): Promise<unknown> {
  const conector = await obtenerConectorActivo();
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
    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new ServiceError("PASARELA_RECHAZO_CREDENCIALES", "Mercado Pago rechazó las credenciales del Conector");
    }
    if (respuesta.status === 404 && operacion === "CONSULTAR_PAGO") {
      throw new ServiceError("PAGO_NO_ENCONTRADO", "Mercado Pago no encontró el pago informado");
    }
    if (respuesta.status >= 500 || respuesta.status === 429) {
      throw new ServiceError("PASARELA_NO_DISPONIBLE", "Mercado Pago no está disponible");
    }
    throw new ServiceError("PASARELA_RESPUESTA_INVALIDA", `Mercado Pago respondió HTTP ${respuesta.status}`);
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
