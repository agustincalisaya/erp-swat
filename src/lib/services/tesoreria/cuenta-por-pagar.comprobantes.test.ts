import assert from "node:assert/strict";
import test from "node:test";

import { validarComprobantesDePago } from "./cuenta-por-pagar.comprobantes.ts";

// HU-G10 — helper puro que decide qué comprobantes NO se pueden imputar a un
// pago y por qué (solo CÓDIGOS, nunca texto humano). Precedencia cuando varios
// motivos aplican a la vez: INEXISTENTE > DE_OTRA_OC > ANULADO > YA_IMPUTADO.

const OC = "oc-objetivo";
const OTRA_OC = "oc-distinta";
const SIN_IMPUTAR = new Set<string>();

test("happy path: todos válidos → []", () => {
  const detalles = validarComprobantesDePago(
    ["c1", "c2"],
    [
      { id: "c1", orden_compra_id: OC, is_active: true },
      { id: "c2", orden_compra_id: OC, is_active: true },
    ],
    OC,
    SIN_IMPUTAR,
  );
  assert.deepEqual(detalles, []);
});

test("NINGUNO_ENVIADO: idsSolicitados vacío", () => {
  const detalles = validarComprobantesDePago([], [], OC, SIN_IMPUTAR);
  assert.deepEqual(detalles, [{ id: "", motivo: "NINGUNO_ENVIADO" }]);
});

test("INEXISTENTE: id que no está en encontrados", () => {
  const detalles = validarComprobantesDePago(["c1"], [], OC, SIN_IMPUTAR);
  assert.deepEqual(detalles, [{ id: "c1", motivo: "INEXISTENTE" }]);
});

test("ANULADO: encontrado pero is_active false", () => {
  const detalles = validarComprobantesDePago(
    ["c1"],
    [{ id: "c1", orden_compra_id: OC, is_active: false }],
    OC,
    SIN_IMPUTAR,
  );
  assert.deepEqual(detalles, [{ id: "c1", motivo: "ANULADO" }]);
});

test("DE_OTRA_OC: encontrado, activo, pero de otra orden de compra", () => {
  const detalles = validarComprobantesDePago(
    ["c1"],
    [{ id: "c1", orden_compra_id: OTRA_OC, is_active: true }],
    OC,
    SIN_IMPUTAR,
  );
  assert.deepEqual(detalles, [{ id: "c1", motivo: "DE_OTRA_OC" }]);
});

test("YA_IMPUTADO: id ya imputado en otro pago", () => {
  const detalles = validarComprobantesDePago(
    ["c1"],
    [{ id: "c1", orden_compra_id: OC, is_active: true }],
    OC,
    new Set(["c1"]),
  );
  assert.deepEqual(detalles, [{ id: "c1", motivo: "YA_IMPUTADO" }]);
});

test("batch mixto: un detalle por cada id inválido, los válidos se omiten", () => {
  const detalles = validarComprobantesDePago(
    ["ok", "inex", "anul", "otra", "imp"],
    [
      { id: "ok", orden_compra_id: OC, is_active: true },
      { id: "anul", orden_compra_id: OC, is_active: false },
      { id: "otra", orden_compra_id: OTRA_OC, is_active: true },
      { id: "imp", orden_compra_id: OC, is_active: true },
    ],
    OC,
    new Set(["imp"]),
  );
  assert.deepEqual(detalles, [
    { id: "inex", motivo: "INEXISTENTE" },
    { id: "anul", motivo: "ANULADO" },
    { id: "otra", motivo: "DE_OTRA_OC" },
    { id: "imp", motivo: "YA_IMPUTADO" },
  ]);
});

test("precedencia: INEXISTENTE gana sobre todo", () => {
  // id no está en encontrados y además figura como ya imputado.
  const detalles = validarComprobantesDePago(
    ["c1"],
    [],
    OC,
    new Set(["c1"]),
  );
  assert.deepEqual(detalles, [{ id: "c1", motivo: "INEXISTENTE" }]);
});

test("precedencia: DE_OTRA_OC gana sobre ANULADO y YA_IMPUTADO", () => {
  const detalles = validarComprobantesDePago(
    ["c1"],
    [{ id: "c1", orden_compra_id: OTRA_OC, is_active: false }],
    OC,
    new Set(["c1"]),
  );
  assert.deepEqual(detalles, [{ id: "c1", motivo: "DE_OTRA_OC" }]);
});

test("precedencia: ANULADO gana sobre YA_IMPUTADO", () => {
  const detalles = validarComprobantesDePago(
    ["c1"],
    [{ id: "c1", orden_compra_id: OC, is_active: false }],
    OC,
    new Set(["c1"]),
  );
  assert.deepEqual(detalles, [{ id: "c1", motivo: "ANULADO" }]);
});
