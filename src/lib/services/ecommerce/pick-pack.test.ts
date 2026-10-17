import assert from "node:assert/strict";
import test from "node:test";
import { calcularProgreso } from "./pick-pack.service.ts";

test("calcularProgreso: 0 líneas → progreso 0% y no completo", () => {
  const progreso = calcularProgreso([]);
  assert.equal(progreso.total_requerido, 0);
  assert.equal(progreso.total_confirmado, 0);
  assert.equal(progreso.porcentaje, 0);
  assert.equal(progreso.completo, false);
});

test("calcularProgreso: línea completa → 100% y completo", () => {
  const progreso = calcularProgreso([{ cantidad_requerida: 3, cantidad_confirmada: 3 }]);
  assert.equal(progreso.total_requerido, 3);
  assert.equal(progreso.total_confirmado, 3);
  assert.equal(progreso.porcentaje, 100);
  assert.equal(progreso.completo, true);
});

test("calcularProgreso: línea parcial → porcentaje redondeado", () => {
  const progreso = calcularProgreso([
    { cantidad_requerida: 3, cantidad_confirmada: 1 },
    { cantidad_requerida: 2, cantidad_confirmada: 0 },
  ]);
  assert.equal(progreso.total_requerido, 5);
  assert.equal(progreso.total_confirmado, 1);
  assert.equal(progreso.porcentaje, 20);
  assert.equal(progreso.completo, false);
});

test("calcularProgreso: no suma confirmaciones por encima de lo requerido", () => {
  const progreso = calcularProgreso([{ cantidad_requerida: 2, cantidad_confirmada: 5 }]);
  assert.equal(progreso.total_confirmado, 2);
  assert.equal(progreso.porcentaje, 100);
  assert.equal(progreso.completo, true);
});

test("calcularProgreso: múltiples líneas parciales → porcentaje redondeado", () => {
  const progreso = calcularProgreso([
    { cantidad_requerida: 4, cantidad_confirmada: 2 },
    { cantidad_requerida: 2, cantidad_confirmada: 1 },
    { cantidad_requerida: 2, cantidad_confirmada: 0 },
  ]);
  assert.equal(progreso.total_requerido, 8);
  assert.equal(progreso.total_confirmado, 3);
  assert.equal(progreso.porcentaje, 38);
  assert.equal(progreso.completo, false);
});

test("calcularProgreso: línea completa y línea vacía → porcentaje ponderado", () => {
  const progreso = calcularProgreso([
    { cantidad_requerida: 5, cantidad_confirmada: 5 },
    { cantidad_requerida: 5, cantidad_confirmada: 0 },
  ]);
  assert.equal(progreso.total_requerido, 10);
  assert.equal(progreso.total_confirmado, 5);
  assert.equal(progreso.porcentaje, 50);
  assert.equal(progreso.completo, false);
});
