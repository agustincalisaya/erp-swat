/**
 * HU-E2 (CA2) — firma de webhooks de Mercado Pago. Unit, sin DB ni red.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  construirManifest,
  decidirFirmaWebhook,
  generarFirmaWebhook,
  validarFirmaWebhook,
  verificarFirmaWebhook,
} from "./firma.ts";

const secret = "clave-secreta-de-prueba";
const xRequestId = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
const ahora = new Date("2026-10-01T15:00:00.000Z");

test("manifest con el formato de Mercado Pago (data.id en minúsculas)", () => {
  assert.equal(construirManifest("ABC123", xRequestId, "1759330800"), `id:abc123;request-id:${xRequestId};ts:1759330800;`);
});

test("firma generada con el mismo secreto → válida", () => {
  const xSignature = generarFirmaWebhook({ dataId: "123456789", xRequestId, secret, ahora });
  assert.equal(validarFirmaWebhook({ xSignature, xRequestId, dataId: "123456789", secret, ahora }), true);
});

test("ejemplo calculado a mano (HMAC-SHA256 del manifest) → válido", () => {
  const ts = String(Math.floor(ahora.getTime() / 1000));
  const v1 = createHmac("sha256", secret).update(`id:987;request-id:${xRequestId};ts:${ts};`).digest("hex");
  assert.equal(
    validarFirmaWebhook({ xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId: "987", secret, ahora }),
    true,
  );
});

test("v1 alterado, otro secreto, otro data.id u otro request-id → inválida", () => {
  const xSignature = generarFirmaWebhook({ dataId: "123", xRequestId, secret, ahora });
  const alterada = xSignature.replace(/v1=(.)/, (_, c: string) => `v1=${c === "0" ? "1" : "0"}`);
  assert.equal(validarFirmaWebhook({ xSignature: alterada, xRequestId, dataId: "123", secret, ahora }), false);
  assert.equal(validarFirmaWebhook({ xSignature, xRequestId, dataId: "123", secret: "otra", ahora }), false);
  assert.equal(validarFirmaWebhook({ xSignature, xRequestId, dataId: "124", secret, ahora }), false);
  assert.equal(validarFirmaWebhook({ xSignature, xRequestId: "otro", dataId: "123", secret, ahora }), false);
});

test("headers ausentes o malformados → inválida", () => {
  assert.equal(validarFirmaWebhook({ xSignature: null, xRequestId, dataId: "1", secret, ahora }), false);
  assert.equal(validarFirmaWebhook({ xSignature: "ts=1,v1=abc", xRequestId: null, dataId: "1", secret, ahora }), false);
  assert.equal(validarFirmaWebhook({ xSignature: "basura", xRequestId, dataId: "1", secret, ahora }), false);
  assert.equal(validarFirmaWebhook({ xSignature: "ts=1", xRequestId, dataId: "1", secret, ahora }), false);
  assert.equal(validarFirmaWebhook({ xSignature: "ts=abc,v1=zz", xRequestId, dataId: "1", secret, ahora }), false);
});

test("ts fuera de la tolerancia (replay) → inválida", () => {
  const vieja = new Date(ahora.getTime() - 60 * 60 * 1000);
  const xSignature = generarFirmaWebhook({ dataId: "123", xRequestId, secret, ahora: vieja });
  assert.equal(validarFirmaWebhook({ xSignature, xRequestId, dataId: "123", secret, ahora }), false);
});

test("verificación detallada: cada causa de falla se distingue", () => {
  const xSignature = generarFirmaWebhook({ dataId: "123", xRequestId, secret, ahora });
  assert.equal(verificarFirmaWebhook({ xSignature, xRequestId, dataId: "123", secret, ahora }), "VALIDA");
  assert.equal(verificarFirmaWebhook({ xSignature, xRequestId, dataId: "123", secret: "otra", ahora }), "HMAC_DISTINTO");
  assert.equal(verificarFirmaWebhook({ xSignature: null, xRequestId, dataId: "123", secret, ahora }), "FALTAN_DATOS");
  assert.equal(verificarFirmaWebhook({ xSignature, xRequestId: null, dataId: "123", secret, ahora }), "FALTAN_DATOS");
  assert.equal(verificarFirmaWebhook({ xSignature: "basura", xRequestId, dataId: "123", secret, ahora }), "FORMATO_INVALIDO");
  const vieja = generarFirmaWebhook({ dataId: "123", xRequestId, secret, ahora: new Date(ahora.getTime() - 3600_000) });
  assert.equal(
    verificarFirmaWebhook({ xSignature: vieja, xRequestId, dataId: "123", secret, ahora }),
    "TS_FUERA_DE_VENTANA",
  );
});

test("decisión: SANDBOX + HMAC distinto en aviso de pago → se procesa sin firma verificada", () => {
  // Firma de MP hecha con la clave del vendedor de prueba (que no tenemos).
  const xSignature = generarFirmaWebhook({ dataId: "183171107114", xRequestId, secret: "clave-del-vendedor", ahora });
  const verificacion = verificarFirmaWebhook({ xSignature, xRequestId, dataId: "183171107114", secret, ahora });
  assert.equal(verificacion, "HMAC_DISTINTO");
  assert.equal(
    decidirFirmaWebhook({ verificacion, entorno: "SANDBOX", esAvisoDePago: true }),
    "PROCESAR_SIN_FIRMA_SANDBOX",
  );
});

test("decisión: PRODUCCION + HMAC distinto → rechaza (401)", () => {
  assert.equal(decidirFirmaWebhook({ verificacion: "HMAC_DISTINTO", entorno: "PRODUCCION", esAvisoDePago: true }), "RECHAZAR");
});

test("decisión: SANDBOX + falta header, formato inválido o ts fuera de ventana → rechaza (401)", () => {
  for (const verificacion of ["FALTAN_DATOS", "FORMATO_INVALIDO", "TS_FUERA_DE_VENTANA"] as const) {
    assert.equal(decidirFirmaWebhook({ verificacion, entorno: "SANDBOX", esAvisoDePago: true }), "RECHAZAR");
  }
  // Header ausente de punta a punta: sin x-request-id no se llega a comparar el HMAC.
  const xSignature = generarFirmaWebhook({ dataId: "1", xRequestId, secret: "clave-del-vendedor", ahora });
  const verificacion = verificarFirmaWebhook({ xSignature, xRequestId: null, dataId: "1", secret, ahora });
  assert.equal(decidirFirmaWebhook({ verificacion, entorno: "SANDBOX", esAvisoDePago: true }), "RECHAZAR");
});

test("decisión: SANDBOX + HMAC distinto fuera de un aviso de pago (otro type o sin data.id en query) → rechaza", () => {
  assert.equal(decidirFirmaWebhook({ verificacion: "HMAC_DISTINTO", entorno: "SANDBOX", esAvisoDePago: false }), "RECHAZAR");
});

test("decisión: firma válida → procesa en ambos entornos", () => {
  assert.equal(decidirFirmaWebhook({ verificacion: "VALIDA", entorno: "SANDBOX", esAvisoDePago: true }), "PROCESAR");
  assert.equal(decidirFirmaWebhook({ verificacion: "VALIDA", entorno: "PRODUCCION", esAvisoDePago: false }), "PROCESAR");
});
