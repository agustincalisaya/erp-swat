import assert from "node:assert/strict";
import test from "node:test";

import { enmascararUltimos4 } from "./cuenta-propia.mascara.ts";

// HU-G5 §9.7 (G5-3) — el enmascarado devuelve, como máximo, los últimos 4
// caracteres de un valor detrás del prefijo "****". Un valor nulo/vacío es
// `null`; uno corto (≤4) se muestra entero detrás de la máscara. La regla vive
// en un módulo puro (`cuenta-propia.mascara.ts`) para poder verificarla sin
// levantar la capa `server-only` del servicio.

test("valor null devuelve null", () => {
  assert.equal(enmascararUltimos4(null), null);
});

test("valor undefined devuelve null", () => {
  assert.equal(enmascararUltimos4(undefined), null);
});

test("string vacío devuelve null", () => {
  assert.equal(enmascararUltimos4(""), null);
});

test("string de solo espacios devuelve null (se recorta antes)", () => {
  assert.equal(enmascararUltimos4("   "), null);
});

test("valor de 1 carácter se muestra entero detrás de la máscara", () => {
  assert.equal(enmascararUltimos4("7"), "****7");
});

test("valor de exactamente 4 caracteres se muestra entero detrás de la máscara", () => {
  assert.equal(enmascararUltimos4("1234"), "****1234");
});

test("valor de 5 caracteres solo expone los últimos 4", () => {
  assert.equal(enmascararUltimos4("12345"), "****2345");
});

test("CBU de 22 dígitos solo expone sus últimos 4", () => {
  assert.equal(enmascararUltimos4("0110599520000001234567"), "****4567");
});

test("el enmascarado recorta espacios antes de tomar la cola", () => {
  assert.equal(enmascararUltimos4("  123456  "), "****3456");
});

test("el valor en claro nunca aparece completo en el resultado (más de 4)", () => {
  const cbu = "0070309530000009876543";
  const enmascarado = enmascararUltimos4(cbu);
  assert.ok(enmascarado !== null);
  assert.ok(!enmascarado.includes(cbu));
  assert.equal(enmascarado, "****6543");
});
