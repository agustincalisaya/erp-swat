/**
 * HU-E2 — Herramienta de prueba local del webhook de Mercado Pago (sin MP real).
 *
 *   npm run mp:firmar -- --pago <payment_id> [--estado approved|rejected|in_process]
 *                        [--monto 15210.00] [--ref <external_reference>]
 *                        [--detalle cc_rejected_insufficient_amount] [--moneda ARS]
 *                        [--url http://localhost:3000] [--secret <clave>]
 *
 * 1. Si viene `--estado`, registra (o pisa) el pago simulado en
 *    `.mp-simulador/pagos.json`: es lo que devuelve `consultarPago()` cuando la
 *    app corre con `MP_MODO=simulado`.
 * 2. Firma la notificación con el esquema real de MP (`x-signature` = ts + v1
 *    HMAC-SHA256 del manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`)
 *    usando la clave secreta del Conector ACTIVO (la misma que valida la app), o
 *    `--secret` si se pasa.
 * 3. Imprime URL, headers, body y un `curl` listos para Postman. La firma vale
 *    15 minutos (tolerancia anti-replay).
 *
 * // PROVISORIO HU-E2 — completar en HU-F1 (owner: Rama)
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { prisma } from "@/lib/db/prisma";
import { obtenerConectorActivo } from "@/lib/integraciones/mercadopago/conector";
import { generarFirmaWebhook } from "@/lib/integraciones/mercadopago/firma";
import { guardarPagoSimulado } from "@/lib/integraciones/mercadopago/simulador";

const { values } = parseArgs({
  options: {
    pago: { type: "string" },
    estado: { type: "string" },
    monto: { type: "string" },
    ref: { type: "string" },
    detalle: { type: "string" },
    moneda: { type: "string", default: "ARS" },
    url: { type: "string", default: "http://localhost:3000" },
    secret: { type: "string" },
  },
});

async function main(): Promise<void> {
  if (!values.pago) {
    throw new Error("Falta --pago <payment_id>. Ej: npm run mp:firmar -- --pago 9000001 --estado approved --monto 15210 --ref <uuid>");
  }

  if (values.estado) {
    if (values.monto === undefined) throw new Error("Con --estado hay que pasar --monto");
    const aprobado = values.estado === "approved";
    guardarPagoSimulado({
      id: values.pago,
      status: values.estado,
      status_detail:
        values.detalle ?? (aprobado ? "accredited" : values.estado === "rejected" ? "cc_rejected_other_reason" : "pending_contingency"),
      transaction_amount: Number(values.monto),
      currency_id: values.moneda!,
      external_reference: values.ref ?? null,
      date_approved: aprobado ? new Date().toISOString() : null,
    });
    console.log(`Pago simulado ${values.pago} registrado en .mp-simulador/pagos.json (${values.estado}, ${values.monto} ${values.moneda}).`);
  }

  const secret = values.secret ?? (await obtenerConectorActivo()).webhook_secret;
  const xRequestId = randomUUID();
  const xSignature = generarFirmaWebhook({ dataId: values.pago, xRequestId, secret });
  const url = `${values.url!.replace(/\/+$/, "")}/api/webhooks/mercadopago?data.id=${values.pago}&type=payment`;
  const body = JSON.stringify({ action: "payment.updated", type: "payment", data: { id: values.pago } });

  console.log("\nPOST", url);
  console.log("Headers:");
  console.log(`  Content-Type: application/json`);
  console.log(`  x-signature: ${xSignature}`);
  console.log(`  x-request-id: ${xRequestId}`);
  console.log("Body:", body);
  console.log("\ncurl:");
  console.log(
    `curl -i -X POST "${url}" -H "Content-Type: application/json" -H "x-signature: ${xSignature}" -H "x-request-id: ${xRequestId}" -d '${body}'`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
