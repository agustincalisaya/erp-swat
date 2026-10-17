/**
 * HU-G11 — schemas Zod de ingresos de Tesorería por cobros online.
 * Verifica validación de UUID, estados admitidos, coercion de paginación y
 * de fechas desde la query string, y los defaults del contrato.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ESTADOS_INGRESO_TESORERIA,
  FiltrosIngresosWebSchema,
  ReprocesarIngresoWebSchema,
} from "./ingresos-web.schema.ts";

test("ESTADOS_INGRESO_TESORERIA tiene exactamente los dos valores de la spec", () => {
  assert.deepEqual([...ESTADOS_INGRESO_TESORERIA], ["PENDIENTE_CONCILIACION", "CONCILIADO"]);
});

test("ReprocesarIngresoWebSchema acepta un uuid válido", () => {
  const parsed = ReprocesarIngresoWebSchema.safeParse({
    pedido_venta_id: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(parsed.success, true);
});

test("ReprocesarIngresoWebSchema rechaza un id que no es uuid", () => {
  const parsed = ReprocesarIngresoWebSchema.safeParse({ pedido_venta_id: "no-es-uuid" });
  assert.equal(parsed.success, false);
});

test("FiltrosIngresosWebSchema aplica defaults de paginación sin parámetros", () => {
  const parsed = FiltrosIngresosWebSchema.safeParse({});
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.page, 1);
  assert.equal(parsed.data.page_size, 25);
});

test("FiltrosIngresosWebSchema coacciona page/page_size desde strings de la URL", () => {
  const parsed = FiltrosIngresosWebSchema.safeParse({ page: "3", page_size: "50" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.page, 3);
  assert.equal(parsed.data.page_size, 50);
});

test("FiltrosIngresosWebSchema rechaza page_size mayor al máximo (100)", () => {
  const parsed = FiltrosIngresosWebSchema.safeParse({ page_size: "101" });
  assert.equal(parsed.success, false);
});

test("FiltrosIngresosWebSchema acepta los estados admitidos y rechaza otros", () => {
  assert.equal(FiltrosIngresosWebSchema.safeParse({ estado: "PENDIENTE_CONCILIACION" }).success, true);
  assert.equal(FiltrosIngresosWebSchema.safeParse({ estado: "CONCILIADO" }).success, true);
  assert.equal(FiltrosIngresosWebSchema.safeParse({ estado: "ANULADO" }).success, false);
});

test("FiltrosIngresosWebSchema coacciona fecha_desde/fecha_hasta a Date", () => {
  const parsed = FiltrosIngresosWebSchema.safeParse({
    fecha_desde: "2026-10-01",
    fecha_hasta: "2026-10-31",
  });
  assert.equal(parsed.success, true);
  assert.ok(parsed.data.fecha_desde instanceof Date);
  assert.ok(parsed.data.fecha_hasta instanceof Date);
});
