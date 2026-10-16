import assert from "node:assert/strict";
import test from "node:test";

import {
  CBU_REGEX,
  CUENTAS_PROPIAS_TIPOS,
  CrearCuentaPropiaSchema,
  DarDeBajaCuentaPropiaSchema,
  EditarCuentaPropiaSchema,
} from "./cuenta-propia.schema.ts";

// HU-G5 §9.7 (G5-1) — schemas Zod de cuentas propias. La forma se valida acá;
// la existencia y el estado `is_active` los resuelve la capa de servicios.

const CBU_VALIDO = "0110599520000001234567"; // 22 dígitos

test("CUENTAS_PROPIAS_TIPOS refleja el enum Prisma TipoCuentaPropia", () => {
  assert.deepEqual([...CUENTAS_PROPIAS_TIPOS], ["BANCARIA", "CAJA"]);
});

test("CBU_REGEX acepta exactamente 22 dígitos y rechaza el resto", () => {
  assert.equal(CBU_REGEX.test("0110599520000001234567"), true);
  assert.equal(CBU_REGEX.test("011059952000000123456"), false); // 21
  assert.equal(CBU_REGEX.test("01105995200000012345678"), false); // 23
  assert.equal(CBU_REGEX.test("01105995200000012345ab"), false); // letras
});

// ──────────────────────────────────────────────────────────────────────────────
// Alta — condicional por tipo
// ──────────────────────────────────────────────────────────────────────────────

test("CAJA sin datos bancarios es válida", () => {
  const res = CrearCuentaPropiaSchema.safeParse({
    nombre: "Caja Chica — Central",
    tipo: "CAJA",
  });
  assert.equal(res.success, true);
});

test("BANCARIA sin banco/cbu/alias falla con error POR CAMPO", () => {
  const res = CrearCuentaPropiaSchema.safeParse({
    nombre: "Cuenta Corriente Principal",
    tipo: "BANCARIA",
  });
  assert.equal(res.success, false);
  if (res.success) return;
  const paths = res.error.issues.map((i) => i.path.join("."));
  assert.ok(paths.includes("banco"), "falta el error de banco");
  assert.ok(paths.includes("cbu"), "falta el error de cbu");
  assert.ok(paths.includes("alias"), "falta el error de alias");
});

test("BANCARIA con banco + CBU de 22 dígitos + alias es válida", () => {
  const res = CrearCuentaPropiaSchema.safeParse({
    nombre: "Banco Nación — Cuenta Corriente Principal",
    tipo: "BANCARIA",
    banco: "Banco Nación",
    cbu: CBU_VALIDO,
    alias: "nacion.cc.principal",
  });
  assert.equal(res.success, true);
});

test("BANCARIA con CBU malformado (21 dígitos) falla en el campo cbu", () => {
  const res = CrearCuentaPropiaSchema.safeParse({
    nombre: "Banco X",
    tipo: "BANCARIA",
    banco: "Banco X",
    cbu: "011059952000000123456",
    alias: "x.alias",
  });
  assert.equal(res.success, false);
  if (res.success) return;
  assert.ok(res.error.issues.some((i) => i.path.join(".") === "cbu"));
});

test("BANCARIA con CBU de 22 caracteres no numéricos falla", () => {
  const res = CrearCuentaPropiaSchema.safeParse({
    nombre: "Banco X",
    tipo: "BANCARIA",
    banco: "Banco X",
    cbu: "01105995200000012345ab",
    alias: "x.alias",
  });
  assert.equal(res.success, false);
});

test("el nombre se recorta (trim) y un nombre vacío falla", () => {
  const conEspacios = CrearCuentaPropiaSchema.safeParse({
    nombre: "  Caja Central  ",
    tipo: "CAJA",
  });
  assert.equal(conEspacios.success, true);
  if (conEspacios.success) assert.equal(conEspacios.data.nombre, "Caja Central");

  const vacio = CrearCuentaPropiaSchema.safeParse({ nombre: "   ", tipo: "CAJA" });
  assert.equal(vacio.success, false);
});

test("un tipo fuera del enum falla", () => {
  const res = CrearCuentaPropiaSchema.safeParse({
    nombre: "X",
    tipo: "CHEQUERA",
  });
  assert.equal(res.success, false);
});

// ──────────────────────────────────────────────────────────────────────────────
// Edición — parcial; la condición por tipo solo aplica si el payload trae `tipo`
// ──────────────────────────────────────────────────────────────────────────────

test("edición de solo nombre (sin tipo) es válida y no exige datos bancarios", () => {
  const res = EditarCuentaPropiaSchema.safeParse({ nombre: "Nuevo nombre" });
  assert.equal(res.success, true);
});

test("edición que declara tipo=BANCARIA exige banco/cbu/alias en el mismo payload", () => {
  const res = EditarCuentaPropiaSchema.safeParse({ tipo: "BANCARIA" });
  assert.equal(res.success, false);
  if (res.success) return;
  const paths = res.error.issues.map((i) => i.path.join("."));
  assert.ok(paths.includes("banco"));
  assert.ok(paths.includes("cbu"));
  assert.ok(paths.includes("alias"));
});

test("edición que declara tipo=CAJA es válida sin datos bancarios", () => {
  const res = EditarCuentaPropiaSchema.safeParse({ tipo: "CAJA" });
  assert.equal(res.success, true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Baja lógica — motivo obligatorio
// ──────────────────────────────────────────────────────────────────────────────

test("baja sin motivo falla", () => {
  assert.equal(DarDeBajaCuentaPropiaSchema.safeParse({ deletion_reason: "" }).success, false);
  assert.equal(
    DarDeBajaCuentaPropiaSchema.safeParse({ deletion_reason: "   " }).success,
    false,
  );
});

test("baja con motivo válido lo recorta y lo acepta", () => {
  const res = DarDeBajaCuentaPropiaSchema.safeParse({
    deletion_reason: "  Cuenta cerrada por el banco  ",
  });
  assert.equal(res.success, true);
  if (res.success) assert.equal(res.data.deletion_reason, "Cuenta cerrada por el banco");
});

test("baja con motivo de 501 caracteres falla", () => {
  const res = DarDeBajaCuentaPropiaSchema.safeParse({
    deletion_reason: "x".repeat(501),
  });
  assert.equal(res.success, false);
});
