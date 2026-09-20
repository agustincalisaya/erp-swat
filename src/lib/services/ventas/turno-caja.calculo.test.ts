import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularSaldoEsperado,
  calcularDiferencia,
  requiereJustificacion,
} from "./turno-caja.calculo.ts";
import { UMBRAL_DIFERENCIA_ARQUEO } from "./turno-caja.constants.ts";

// ── calcularSaldoEsperado ────────────────────────────────────────────────────

test("calcularSaldoEsperado: suma el fondo fijo inicial y el total de ventas en efectivo", () => {
  assert.equal(calcularSaldoEsperado(5000, 12500), 17500);
});

test("calcularSaldoEsperado: sin ventas en efectivo (HU-B1 todavía no existe), el saldo es el fondo inicial", () => {
  assert.equal(calcularSaldoEsperado(5000, 0), 5000);
});

test("calcularSaldoEsperado: redondea a 2 decimales, sin artefactos de punto flotante", () => {
  assert.equal(calcularSaldoEsperado(0.1, 0.2), 0.3);
});

// ── calcularDiferencia ───────────────────────────────────────────────────────

test("calcularDiferencia: conteo físico exacto da diferencia 0", () => {
  assert.equal(calcularDiferencia(5000, 5000), 0);
});

test("calcularDiferencia: conteo físico por debajo del esperado da diferencia positiva (faltante)", () => {
  assert.equal(calcularDiferencia(5000, 4800), 200);
});

test("calcularDiferencia: conteo físico por encima del esperado da diferencia negativa (sobrante)", () => {
  assert.equal(calcularDiferencia(5000, 5300), -300);
});

test("calcularDiferencia: redondea a 2 decimales", () => {
  assert.equal(calcularDiferencia(100.1, 100.05), 0.05);
});

// ── requiereJustificacion (umbral real: UMBRAL_DIFERENCIA_ARQUEO = 500) ──────

test("requiereJustificacion: diferencia dentro del umbral, sin justificacion — no requiere", () => {
  assert.equal(requiereJustificacion(UMBRAL_DIFERENCIA_ARQUEO, undefined), false);
  assert.equal(requiereJustificacion(-UMBRAL_DIFERENCIA_ARQUEO, undefined), false);
  assert.equal(requiereJustificacion(0, undefined), false);
});

test("requiereJustificacion: diferencia fuera del umbral (positiva o negativa), sin justificacion — requiere", () => {
  assert.equal(requiereJustificacion(UMBRAL_DIFERENCIA_ARQUEO + 0.01, undefined), true);
  assert.equal(requiereJustificacion(-(UMBRAL_DIFERENCIA_ARQUEO + 0.01), undefined), true);
});

test("requiereJustificacion: diferencia fuera del umbral, CON justificacion — no requiere (ya cumplida)", () => {
  assert.equal(requiereJustificacion(UMBRAL_DIFERENCIA_ARQUEO + 1000, "Vuelto mal entregado"), false);
});

test("requiereJustificacion: justificacion en blanco (solo espacios) no cuenta como justificación real", () => {
  assert.equal(requiereJustificacion(UMBRAL_DIFERENCIA_ARQUEO + 1000, "   "), true);
  assert.equal(requiereJustificacion(UMBRAL_DIFERENCIA_ARQUEO + 1000, ""), true);
});
