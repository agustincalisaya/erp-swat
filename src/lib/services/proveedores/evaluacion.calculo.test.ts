import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularPuntajeCalidad,
  calcularPuntajePlazos,
  calcularPuntajeTotal,
} from "./evaluacion.calculo.ts";

test("calcularPuntajePlazos: caso normal, atraso de 3 días penaliza 5 puntos por día", () => {
  const fechaEntregaComprometida = new Date("2026-08-01T00:00:00.000Z");
  const fechaRecepcion = new Date("2026-08-04T00:00:00.000Z");
  assert.equal(calcularPuntajePlazos(fechaRecepcion, fechaEntregaComprometida), 85);
});

test("calcularPuntajePlazos: recepción el mismo día de la fecha comprometida no penaliza", () => {
  const fecha = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(calcularPuntajePlazos(fecha, fecha), 100);
});

test("calcularPuntajePlazos: recepción anticipada no penaliza (dias_atraso nunca negativo)", () => {
  const fechaEntregaComprometida = new Date("2026-08-10T00:00:00.000Z");
  const fechaRecepcion = new Date("2026-08-05T00:00:00.000Z");
  assert.equal(calcularPuntajePlazos(fechaRecepcion, fechaEntregaComprometida), 100);
});

test("calcularPuntajePlazos: un atraso grande hace clamp a 0, nunca negativo", () => {
  const fechaEntregaComprometida = new Date("2026-08-01T00:00:00.000Z");
  const fechaRecepcion = new Date("2026-09-01T00:00:00.000Z"); // 31 días de atraso
  assert.equal(calcularPuntajePlazos(fechaRecepcion, fechaEntregaComprometida), 0);
});

test("calcularPuntajePlazos: fechaEntregaComprometida null devuelve 100 sin bloquear el cálculo", () => {
  const fechaRecepcion = new Date("2026-08-04T00:00:00.000Z");
  assert.equal(calcularPuntajePlazos(fechaRecepcion, null), 100);
});

test("calcularPuntajeCalidad: sin discrepancias, todos los ítems cuentan", () => {
  assert.equal(calcularPuntajeCalidad(10, 0), 100);
});

test("calcularPuntajeCalidad: todos los ítems con discrepancia da 0", () => {
  assert.equal(calcularPuntajeCalidad(10, 10), 0);
});

test("calcularPuntajeCalidad: caso normal, porcentaje redondeado", () => {
  assert.equal(calcularPuntajeCalidad(3, 1), 67); // 2/3 = 66.67 -> 67
});

test("calcularPuntajeTotal: ponderación igualitaria, redondeado a 2 decimales", () => {
  assert.equal(calcularPuntajeTotal(85, 67, 100), 84);
});

test("calcularPuntajeTotal: valores dispares producen 2 decimales exactos", () => {
  assert.equal(calcularPuntajeTotal(100, 0, 50), 50);
  assert.equal(calcularPuntajeTotal(90, 80, 70), 80);
});
