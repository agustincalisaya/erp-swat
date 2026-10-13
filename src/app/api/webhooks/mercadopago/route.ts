/**
 * @module route — POST /api/webhooks/mercadopago
 * @description HU-E2 / mínimo de HU-F1 (spec_modulo_F.md §2.1.3). Única ruta
 * del sistema sin sesión: se autentica por FIRMA (CA2) — `x-signature` +
 * `x-request-id` validados con la clave secreta del Conector ACTIVO.
 *
 *  - Formato IPN (`?id=…&topic=…` sin `type`) → 200 `SIN_EFECTO` sin validar
 *    firma ni procesar; solo se registra la traza (evita reintentos de MP).
 *  - Formato webhook (`?data.id=…&type=…`) con firma inválida, ausente o sin
 *    Conector → 401 `FIRMA_INVALIDA`, sin procesar ni registrar nada (no se
 *    distingue la causa, spec F §2.1.3).
 *  - Excepción SOLO SANDBOX: aviso de pago (`?data.id=…&type=payment`) con
 *    headers completos y `ts` en ventana pero HMAC distinto → se procesa igual,
 *    con traza `FIRMA_NO_VERIFICADA_SANDBOX` (limitación de MP con cuentas de
 *    prueba; ver `decidirFirmaWebhook`). En PRODUCCION → 401 sin excepción.
 *  - Los avisos se reciben solo por la URL configurada en el panel de Webhooks
 *    de MP: la preferencia NO envía `notification_url` (sus avisos no firman con
 *    la clave del panel).
 *  - `type` distinto de `payment` → 200 sin efectos.
 *  - Pago → se procesa SÍNCRONAMENTE (task HU-E2 P12, desviación de spec F
 *    §2.1.3) y recién ahí 200. Duplicados y pedidos ya resueltos → 200 sin
 *    efectos (CA3). Error de procesamiento → 500, para que MP reintente (la
 *    idempotencia por transición hace seguro el reintento).
 *
 * Owner: HU-E2 (Chiki). Definitivo, acordado con Rama (HU-F1) el 2026-10-08.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";
import { obtenerConectorActivo, type ConectorActivo } from "@/lib/integraciones/mercadopago/conector";
import { decidirFirmaWebhook, verificarFirmaWebhook } from "@/lib/integraciones/mercadopago/firma";
import { procesarNotificacionPago, registrarTrazaWebhook } from "@/lib/services/ecommerce/pago-web.service";

interface CuerpoNotificacion {
  type?: string;
  topic?: string;
  data?: { id?: string | number };
}

function leerCuerpo(texto: string): CuerpoNotificacion {
  try {
    const json: unknown = JSON.parse(texto);
    return json && typeof json === "object" ? (json as CuerpoNotificacion) : {};
  } catch {
    return {};
  }
}

const firmaInvalida = () =>
  NextResponse.json(
    { data: null, error: { code: "FIRMA_INVALIDA", message: "No se pudo validar la autenticidad del webhook" } },
    { status: 401 },
  );

export async function POST(request: NextRequest) {
  const cuerpo = leerCuerpo(await request.text());
  const query = request.nextUrl.searchParams;
  // MP firma el `data.id` de la query; el body es el respaldo.
  const dataId = query.get("data.id") ?? (cuerpo.data?.id !== undefined ? String(cuerpo.data.id) : null);
  const tipo = query.get("type") ?? cuerpo.type ?? cuerpo.topic ?? "";
  const xRequestId = request.headers.get("x-request-id");

  // Formato IPN (`?id=…&topic=…`, sin `type`): no se firma ni se procesa. 200 para
  // que MP no lo reintente; queda la traza. No autentica nada ni cambia datos.
  if (query.has("topic") && !query.has("type")) {
    const topic = query.get("topic") ?? "";
    await registrarTrazaWebhook(query.get("id") ?? "", topic, xRequestId, "SIN_EFECTO");
    return NextResponse.json({ data: { recibido: true, resultado: "SIN_EFECTO" }, error: null });
  }

  let conector: ConectorActivo;
  try {
    conector = await obtenerConectorActivo();
  } catch {
    return firmaInvalida();
  }
  const decision = decidirFirmaWebhook({
    verificacion: verificarFirmaWebhook({
      xSignature: request.headers.get("x-signature"),
      xRequestId,
      dataId,
      secret: conector.webhook_secret,
    }),
    entorno: conector.entorno,
    esAvisoDePago: query.has("data.id") && query.get("type") === "payment",
  });
  if (decision === "RECHAZAR") return firmaInvalida();
  const paymentId = dataId!;

  if (decision === "PROCESAR_SIN_FIRMA_SANDBOX") {
    // Limitación de MP con cuentas de prueba (ver `decidirFirmaWebhook`): el pago
    // se valida igual contra la API de MP en `procesarNotificacionPago`.
    console.warn(
      "[POST /api/webhooks/mercadopago] SANDBOX: HMAC distinto, se procesa sin firma verificada",
      paymentId,
      xRequestId,
    );
    await registrarTrazaWebhook(paymentId, tipo, xRequestId, "FIRMA_NO_VERIFICADA_SANDBOX");
  }

  if (tipo !== "payment") {
    return NextResponse.json({ data: { recibido: true, payment_id: paymentId, resultado: "SIN_EFECTO" }, error: null });
  }

  try {
    const procesado = await procesarNotificacionPago(paymentId);
    await registrarTrazaWebhook(paymentId, tipo, xRequestId, procesado.resultado);
    return NextResponse.json({
      data: { recibido: true, payment_id: paymentId, resultado: procesado.resultado, motivo: procesado.motivo ?? null },
      error: null,
    });
  } catch (error) {
    await registrarTrazaWebhook(paymentId, tipo, xRequestId, "ERROR");
    console.error("[POST /api/webhooks/mercadopago] Error al procesar el pago", paymentId, error);
    const code = error instanceof ServiceError ? error.code : "ERROR_INTERNO";
    return NextResponse.json(
      { data: null, error: { code, message: "No se pudo procesar la notificación; Mercado Pago reintentará" } },
      { status: 500 },
    );
  }
}
