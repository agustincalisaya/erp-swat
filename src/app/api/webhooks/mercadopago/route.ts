/**
 * @module route — POST /api/webhooks/mercadopago
 * @description HU-E2 / mínimo de HU-F1 (spec_modulo_F.md §2.1.3). Única ruta
 * del sistema sin sesión: se autentica por FIRMA (CA2) — `x-signature` +
 * `x-request-id` validados con la clave secreta del Conector ACTIVO.
 *
 *  - Firma inválida, ausente o sin Conector → 401 `FIRMA_INVALIDA`, sin procesar
 *    ni registrar nada (no se distingue la causa, spec F §2.1.3).
 *  - `type` distinto de `payment` → 200 sin efectos.
 *  - Pago → se procesa SÍNCRONAMENTE (task HU-E2 P12, desviación de spec F
 *    §2.1.3) y recién ahí 200. Duplicados y pedidos ya resueltos → 200 sin
 *    efectos (CA3). Error de procesamiento → 500, para que MP reintente (la
 *    idempotencia por transición hace seguro el reintento).
 *
 * // PROVISORIO HU-E2 — completar en HU-F1 (owner: Rama)
 */
import { NextResponse, type NextRequest } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";
import { obtenerConectorActivo } from "@/lib/integraciones/mercadopago/conector";
import { validarFirmaWebhook } from "@/lib/integraciones/mercadopago/firma";
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

  let secreto: string;
  try {
    secreto = (await obtenerConectorActivo()).webhook_secret;
  } catch {
    return firmaInvalida();
  }
  if (!validarFirmaWebhook({ xSignature: request.headers.get("x-signature"), xRequestId, dataId, secret: secreto })) {
    return firmaInvalida();
  }
  const paymentId = dataId!;

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
