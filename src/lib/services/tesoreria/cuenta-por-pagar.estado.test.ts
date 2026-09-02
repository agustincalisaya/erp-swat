import assert from "node:assert/strict";
import test from "node:test";
import { esTransicionValidaCuentaPorPagar } from "./cuenta-por-pagar.calculo.ts";

// HU-G8 §3.1 / §3.2 — la máquina de estados de CuentaPorPagar solo admite
// PROVISORIO → DEFINITIVA (DEFINIR), PROVISORIO → CANCELADA (CANCELAR) y
// DEFINITIVA → PAGADA (PAGAR). Cualquier otro par (estado, acción) es inválido.

test("esTransicionValidaCuentaPorPagar: DEFINITIVA admite PAGAR", () => {
  assert.equal(esTransicionValidaCuentaPorPagar("DEFINITIVA", "PAGAR"), true);
});

test("esTransicionValidaCuentaPorPagar: PROVISORIO admite DEFINIR", () => {
  assert.equal(esTransicionValidaCuentaPorPagar("PROVISORIO", "DEFINIR"), true);
});

test("esTransicionValidaCuentaPorPagar: PROVISORIO admite CANCELAR", () => {
  assert.equal(esTransicionValidaCuentaPorPagar("PROVISORIO", "CANCELAR"), true);
});

test("esTransicionValidaCuentaPorPagar: PAGAR solo es válido desde DEFINITIVA", () => {
  assert.equal(esTransicionValidaCuentaPorPagar("PROVISORIO", "PAGAR"), false);
  assert.equal(esTransicionValidaCuentaPorPagar("PAGADA", "PAGAR"), false);
  assert.equal(esTransicionValidaCuentaPorPagar("CANCELADA", "PAGAR"), false);
});

test("esTransicionValidaCuentaPorPagar: DEFINIR no es válido desde DEFINITIVA", () => {
  assert.equal(esTransicionValidaCuentaPorPagar("DEFINITIVA", "DEFINIR"), false);
});

test("esTransicionValidaCuentaPorPagar: CANCELAR no es válido desde DEFINITIVA ni PAGADA", () => {
  assert.equal(esTransicionValidaCuentaPorPagar("DEFINITIVA", "CANCELAR"), false);
  assert.equal(esTransicionValidaCuentaPorPagar("PAGADA", "CANCELAR"), false);
});
