import assert from "node:assert/strict";
import test from "node:test";

import {
  MarcarPagadaSchema,
  esFechaPagoNoFutura,
  MEDIOS_PAGO,
} from "./cuentas-por-pagar.schema.ts";

// HU-G10 — el pago de una Cuenta por Pagar ahora exige medio de pago, cuenta de
// origen y al menos un comprobante imputado; `observaciones` sigue siendo
// opcional y acotada a 500 chars. `fecha_pago` no puede ser futura.

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUENTA_ORIGEN_OK = "banco-nacion-cc-principal";

function bodyBase() {
  return {
    medio_pago: "TRANSFERENCIA",
    cuenta_origen_id: CUENTA_ORIGEN_OK,
    comprobante_proveedor_ids: [UUID_A, UUID_B],
  };
}

test("MEDIOS_PAGO expone los tres medios del enum Prisma", () => {
  assert.deepEqual([...MEDIOS_PAGO], ["TRANSFERENCIA", "CHEQUE", "EFECTIVO"]);
});

test("rechaza si falta medio_pago", () => {
  const { medio_pago, ...sinMedio } = bodyBase();
  void medio_pago;
  assert.equal(MarcarPagadaSchema.safeParse(sinMedio).success, false);
});

test("rechaza si falta cuenta_origen_id", () => {
  const { cuenta_origen_id, ...sinCuenta } = bodyBase();
  void cuenta_origen_id;
  assert.equal(MarcarPagadaSchema.safeParse(sinCuenta).success, false);
});

test("rechaza si falta comprobante_proveedor_ids", () => {
  const { comprobante_proveedor_ids, ...sinComprobantes } = bodyBase();
  void comprobante_proveedor_ids;
  assert.equal(MarcarPagadaSchema.safeParse(sinComprobantes).success, false);
});

test("rechaza comprobante_proveedor_ids vacío", () => {
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    comprobante_proveedor_ids: [],
  });
  assert.equal(res.success, false);
});

test("rechaza comprobante_proveedor_ids con duplicados", () => {
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    comprobante_proveedor_ids: [UUID_A, UUID_A],
  });
  assert.equal(res.success, false);
});

test("rechaza un medio_pago fuera del enum", () => {
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    medio_pago: "CRIPTO",
  });
  assert.equal(res.success, false);
});

test("rechaza cuenta_origen_id inexistente en el catálogo", () => {
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    cuenta_origen_id: "cuenta-fantasma",
  });
  assert.equal(res.success, false);
});

test("rechaza observaciones de 501 caracteres", () => {
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    observaciones: "x".repeat(501),
  });
  assert.equal(res.success, false);
});

test("acepta observaciones de 500 caracteres", () => {
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    observaciones: "x".repeat(500),
  });
  assert.equal(res.success, true);
});

test("rechaza una fecha_pago futura", () => {
  const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    fecha_pago: futuro.toISOString(),
  });
  assert.equal(res.success, false);
});

test("fecha_pago omitida resuelve a un Date ~ ahora", () => {
  const antes = Date.now();
  const res = MarcarPagadaSchema.safeParse(bodyBase());
  assert.equal(res.success, true);
  if (!res.success) return;
  assert.ok(res.data.fecha_pago instanceof Date);
  const delta = Math.abs(res.data.fecha_pago.getTime() - antes);
  assert.ok(delta < 5000, `delta ${delta}ms fuera de tolerancia`);
});

test("esFechaPagoNoFutura: pasado → true, ahora exacto → true, futuro → false", () => {
  const ahora = new Date("2026-06-01T12:00:00.000Z");
  assert.equal(
    esFechaPagoNoFutura(new Date("2026-05-31T12:00:00.000Z"), ahora),
    true,
  );
  assert.equal(esFechaPagoNoFutura(new Date(ahora), ahora), true);
  assert.equal(
    esFechaPagoNoFutura(new Date("2026-06-02T12:00:00.000Z"), ahora),
    false,
  );
});

test("el output parseado tiene exactamente las claves de MarcarCuentaPorPagarPagadaInput", () => {
  const res = MarcarPagadaSchema.safeParse({
    ...bodyBase(),
    observaciones: "pago parcial acordado",
  });
  assert.equal(res.success, true);
  if (!res.success) return;
  // Drift guard: si el service cambia el shape de MarcarCuentaPorPagarPagadaInput
  // sin tocar el schema (o al revés), este set deja de coincidir.
  const esperadas = [
    "fecha_pago",
    "medio_pago",
    "cuenta_origen_id",
    "comprobante_proveedor_ids",
    "observaciones",
  ].sort();
  assert.deepEqual(Object.keys(res.data).sort(), esperadas);
});
