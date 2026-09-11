import assert from "node:assert/strict";
import test from "node:test";

import {
  esCuentaOrigenValida,
  listarCuentasOrigen,
} from "./cuentas-origen.ts";

// HU-G10 — catálogo PLACEHOLDER de cuentas de origen del pago. Sin entidad
// `CuentaBancaria` / `CajaChica` real todavía: la validación es contra una
// lista fija en código (ver `cuentas-origen.ts`).

test("listarCuentasOrigen: devuelve una lista no vacía", () => {
  const cuentas = listarCuentasOrigen();
  assert.ok(Array.isArray(cuentas));
  assert.ok(cuentas.length > 0);
});

test("esCuentaOrigenValida: un id conocido del catálogo es válido", () => {
  const [primera] = listarCuentasOrigen();
  assert.equal(esCuentaOrigenValida(primera.id), true);
});

test("esCuentaOrigenValida: un id desconocido es inválido", () => {
  assert.equal(esCuentaOrigenValida("cuenta-que-no-existe"), false);
});

test("esCuentaOrigenValida: el string vacío es inválido", () => {
  assert.equal(esCuentaOrigenValida(""), false);
});
