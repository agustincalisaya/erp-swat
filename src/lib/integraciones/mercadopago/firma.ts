/**
 * Validación de la firma de los webhooks de Mercado Pago (CA2 de HU-E2,
 * spec_modulo_F.md §2.1.3). Esquema REAL de Mercado Pago (task HU-E2 §3.4.3:
 * difiere de la redacción de spec F, que habla de "payload crudo"):
 *
 *   x-signature:  ts=<unix seg>,v1=<hex HMAC-SHA256>
 *   x-request-id: <uuid>
 *   manifest:     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *   v1 = HMAC-SHA256(clave secreta del webhook, manifest)
 *
 * `data.id` llega en la query (`?data.id=...&type=payment`); si es
 * alfanumérico MP lo firma en minúsculas. Comparación en tiempo constante.
 * Fallback SOLO SANDBOX para HMAC distinto: ver `decidirFirmaWebhook`.
 * Funciones puras (sin Prisma ni `server-only`): las usan el route, los tests
 * y `scripts/firmar-webhook-mp.ts`.
 *
 * Owner: HU-E2 (Chiki). Definitivo, acordado con Rama (HU-F1) el 2026-10-08.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Ventana aceptada entre `ts` y la hora del servidor (anti-replay). */
export const TOLERANCIA_FIRMA_SEGUNDOS = 15 * 60;

export interface FirmaWebhookInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  /** Default: ahora. */
  ahora?: Date;
  toleranciaSeg?: number;
}

export function construirManifest(dataId: string, xRequestId: string, ts: string): string {
  return `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
}

function parsearXSignature(xSignature: string): { ts: string; v1: string } | null {
  const partes = new Map<string, string>();
  for (const parte of xSignature.split(",")) {
    const [clave, ...resto] = parte.split("=");
    if (clave && resto.length > 0) partes.set(clave.trim(), resto.join("=").trim());
  }
  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  return ts && v1 ? { ts, v1 } : null;
}

/** Resultado detallado de la verificación (la decisión de rechazar va aparte). */
export type VerificacionFirma = "VALIDA" | "FALTAN_DATOS" | "FORMATO_INVALIDO" | "TS_FUERA_DE_VENTANA" | "HMAC_DISTINTO";

export function verificarFirmaWebhook(input: FirmaWebhookInput): VerificacionFirma {
  if (!input.xSignature || !input.xRequestId || !input.dataId || !input.secret) return "FALTAN_DATOS";
  const firma = parsearXSignature(input.xSignature);
  if (!firma || !/^\d+$/.test(firma.ts) || !/^[0-9a-f]+$/i.test(firma.v1)) return "FORMATO_INVALIDO";

  // MP manda `ts` en segundos; se aceptan también milisegundos por tolerancia.
  const tsNumero = Number(firma.ts);
  const tsSegundos = tsNumero > 1e12 ? tsNumero / 1000 : tsNumero;
  const ahoraSeg = (input.ahora ?? new Date()).getTime() / 1000;
  if (Math.abs(ahoraSeg - tsSegundos) > (input.toleranciaSeg ?? TOLERANCIA_FIRMA_SEGUNDOS)) {
    return "TS_FUERA_DE_VENTANA";
  }

  const esperada = createHmac("sha256", input.secret)
    .update(construirManifest(input.dataId, input.xRequestId, firma.ts))
    .digest();
  const recibida = Buffer.from(firma.v1, "hex");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada) ? "VALIDA" : "HMAC_DISTINTO";
}

/** `true` solo si la firma corresponde al manifest y `ts` está dentro de la tolerancia. */
export function validarFirmaWebhook(input: FirmaWebhookInput): boolean {
  return verificarFirmaWebhook(input) === "VALIDA";
}

export type DecisionFirmaWebhook = "PROCESAR" | "PROCESAR_SIN_FIRMA_SANDBOX" | "RECHAZAR";

/**
 * Qué hace el webhook según la verificación de la firma.
 *
 * Limitación conocida de MP con cuentas de prueba de Checkout Pro: los avisos de
 * pagos reales se firman con la clave del usuario VENDEDOR de prueba, que no
 * tiene acceso al panel de Webhooks para obtenerla → el HMAC nunca coincide con
 * la clave cargada. Por eso, SOLO en SANDBOX y SOLO para un aviso de pago en
 * formato webhook (`?data.id=…&type=payment`) con headers completos y `ts` en
 * ventana, un HMAC distinto no se rechaza: se procesa igual, y el flujo normal
 * consulta el pago a MP (`consultarPago`) y valida `external_reference` y monto.
 * Faltan headers, formato inválido o `ts` fuera de ventana → siempre se rechaza.
 * En PRODUCCION no hay excepción.
 */
export function decidirFirmaWebhook(params: {
  verificacion: VerificacionFirma;
  entorno: "SANDBOX" | "PRODUCCION";
  esAvisoDePago: boolean;
}): DecisionFirmaWebhook {
  if (params.verificacion === "VALIDA") return "PROCESAR";
  if (params.verificacion === "HMAC_DISTINTO" && params.entorno === "SANDBOX" && params.esAvisoDePago) {
    return "PROCESAR_SIN_FIRMA_SANDBOX";
  }
  return "RECHAZAR";
}

/** Genera un `x-signature` válido (pruebas locales y tests; MP firma igual). */
export function generarFirmaWebhook(params: {
  dataId: string;
  xRequestId: string;
  secret: string;
  ahora?: Date;
}): string {
  const ts = String(Math.floor((params.ahora ?? new Date()).getTime() / 1000));
  const v1 = createHmac("sha256", params.secret)
    .update(construirManifest(params.dataId, params.xRequestId, ts))
    .digest("hex");
  return `ts=${ts},v1=${v1}`;
}
