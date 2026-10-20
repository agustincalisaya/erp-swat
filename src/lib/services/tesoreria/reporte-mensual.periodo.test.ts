import assert from "node:assert/strict";
import test from "node:test";
import { interpretarMesReporte } from "./reporte-mensual.periodo";
import { dineroReporte, nombreMesReporte } from "./reporte-mensual.presentacion";

test("G14: el mes futuro se rechaza según la medianoche de Argentina", () => {
  const antesDeMedianocheArgentina = new Date("2026-11-01T02:59:59.000Z");
  assert.equal(interpretarMesReporte("2026-11", antesDeMedianocheArgentina), null);
  assert.equal(interpretarMesReporte("2026-10", antesDeMedianocheArgentina)?.mesIso, "2026-10");
  assert.equal(interpretarMesReporte("2026-09", antesDeMedianocheArgentina)?.mesIso, "2026-09");
  assert.equal(interpretarMesReporte(undefined, antesDeMedianocheArgentina)?.mesIso, "2026-10");
  assert.equal(interpretarMesReporte("2026-11", new Date("2026-11-01T03:00:00.000Z"))?.mesIso, "2026-11");
});

test("G14/G16: nombres de mes y pesos para la presentación", () => {
  assert.equal(nombreMesReporte("2026-09"), "Septiembre 2026");
  assert.equal(nombreMesReporte("2026-10"), "Octubre 2026");
  assert.equal(nombreMesReporte("2026-09", true), "Sep");
  assert.equal(nombreMesReporte("2026-10", true), "Oct");
  assert.equal(dineroReporte("7268500.00"), "$ 7.268.500,00");
  assert.equal(dineroReporte("-5582000.50"), "−$ 5.582.000,50");
});
