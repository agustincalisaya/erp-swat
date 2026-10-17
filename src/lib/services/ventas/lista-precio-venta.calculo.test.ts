import assert from "node:assert/strict";
import test from "node:test";
import { calcularPrecioSugerido, validarBajoCosto } from "./lista-precio-venta.calculo.ts";

// ── calcularPrecioSugerido (Punto abierto 8: sin redondeo comercial) ─────────

test("calcularPrecioSugerido: costo × (1 + margen) exacto a 2 decimales, sin redondear a la centena", () => {
  assert.equal(calcularPrecioSugerido(15600, 0.35), 21060);
  assert.equal(calcularPrecioSugerido(16900, 0.35), 22815);
  assert.equal(calcularPrecioSugerido(15950, 0.35), 21532.5);
});

test("calcularPrecioSugerido: sin artefactos de punto flotante", () => {
  assert.equal(calcularPrecioSugerido(0.1, 0.2), 0.12);
  assert.equal(calcularPrecioSugerido(1999.99, 0.35), 2699.99);
});

test("calcularPrecioSugerido: margen 0 devuelve el costo; sin costo devuelve null", () => {
  assert.equal(calcularPrecioSugerido(43500, 0), 43500);
  assert.equal(calcularPrecioSugerido(null, 0.35), null);
});

// ── validarBajoCosto ─────────────────────────────────────────────────────────

test("validarBajoCosto: sin costo de referencia (null) no aplica la validación", () => {
  assert.deepEqual(validarBajoCosto(1, null), { ok: true, confirmado_bajo_costo: false });
});

test("validarBajoCosto: precio igual al costo NO es bajo costo", () => {
  assert.deepEqual(validarBajoCosto(16900, 16900), { ok: true, confirmado_bajo_costo: false });
});

test("validarBajoCosto: precio mayor al costo pasa aunque traiga motivo (no se marca bajo costo)", () => {
  assert.deepEqual(validarBajoCosto(23000, 15600, "no hacía falta"), { ok: true, confirmado_bajo_costo: false });
});

test("validarBajoCosto: precio menor sin motivo → MOTIVO_BAJO_COSTO_REQUERIDO", () => {
  assert.deepEqual(validarBajoCosto(15000, 16900), { ok: false, code: "MOTIVO_BAJO_COSTO_REQUERIDO" });
  assert.deepEqual(validarBajoCosto(15000, 16900, "   "), { ok: false, code: "MOTIVO_BAJO_COSTO_REQUERIDO" });
});

test("validarBajoCosto: precio menor con motivo → confirmado_bajo_costo", () => {
  assert.deepEqual(validarBajoCosto(15000, 16900, "Liquidación de temporada"), {
    ok: true,
    confirmado_bajo_costo: true,
  });
});
