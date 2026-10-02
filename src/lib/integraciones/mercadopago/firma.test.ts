/**
 * HU-E2 (CA2) — firma de webhooks de Mercado Pago. Unit, sin DB ni red.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { construirManifest, generarFirmaWebhook, validarFirmaWebhook } from "./firma.ts";

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
