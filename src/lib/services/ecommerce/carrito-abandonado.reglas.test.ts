import assert from "node:assert/strict";
import test from "node:test";
import { calcularFechaCorteAbandono } from "./carrito-abandonado.reglas.ts";

/** HU-E5 (criterio 5, D4) — corte de carritos abandonados. */

const AHORA = new Date("2026-10-04T15:30:00.000Z");
const DIA_MS = 86_400_000;

/** Misma condición que aplica el servicio: `updated_at < corte`. */
const abandonado = (updatedAt: Date, plazo: number) => updatedAt < calcularFechaCorteAbandono(AHORA, plazo);

test("plazo 1: el corte es exactamente 24 h antes", () => {
  assert.equal(calcularFechaCorteAbandono(AHORA, 1).toISOString(), "2026-10-03T15:30:00.000Z");
});

test("plazo 7 (default sembrado): el corte es exactamente 7 días antes", () => {
  assert.equal(calcularFechaCorteAbandono(AHORA, 7).toISOString(), "2026-09-27T15:30:00.000Z");
});

test("fecha exacta de corte: NO está abandonado; 1 ms antes sí", () => {
  const corte = calcularFechaCorteAbandono(AHORA, 7);
  assert.equal(abandonado(corte, 7), false, "sin actividad por exactamente el plazo no es 'más del plazo'");
  assert.equal(abandonado(new Date(corte.getTime() - 1), 7), true);
  assert.equal(abandonado(new Date(corte.getTime() + 1), 7), false);
});

test("actividad reciente nunca queda abandonada", () => {
  assert.equal(abandonado(AHORA, 1), false);
  assert.equal(abandonado(new Date(AHORA.getTime() - DIA_MS + 1), 1), false);
});

test("no muta la fecha de referencia", () => {
  const ahora = new Date(AHORA);
  calcularFechaCorteAbandono(ahora, 7);
  assert.equal(ahora.getTime(), AHORA.getTime());
});

test("rechaza plazos que no son enteros positivos y fechas inválidas", () => {
  for (const plazo of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calcularFechaCorteAbandono(AHORA, plazo), RangeError, String(plazo));
  }
  assert.throws(() => calcularFechaCorteAbandono(new Date("no-es-fecha"), 7), RangeError);
});
