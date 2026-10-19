/**
 * HU-G7 §9.8 — schemas Zod de la posición diaria
 * (`posicion-diaria.schema.ts`). Runner nativo de Node:
 * `node --experimental-strip-types --test <este archivo>`. La forma se valida
 * acá; la existencia de la cuenta y su estado `is_active` los resuelve el
 * servicio.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { DiaIsoSchema, RegistrarSaldoDiarioSchema } from "./posicion-diaria.schema.ts";
import { diaNegocioIso } from "../utils/fecha-negocio.ts";

/** Día `AAAA-MM-DD` desplazado `dias` respecto del día de negocio de hoy. */
function diaRelativo(dias: number): string {
  const base = new Date(`${diaNegocioIso()}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

// ── Día de negocio ────────────────────────────────────────────────────────────

test("DiaIsoSchema acepta un día pasado válido y el día de hoy", () => {
  assert.equal(DiaIsoSchema.safeParse("2000-01-01").success, true);
  assert.equal(DiaIsoSchema.safeParse(diaNegocioIso()).success, true);
});

test("DiaIsoSchema rechaza un día futuro", () => {
  const resultado = DiaIsoSchema.safeParse(diaRelativo(1));
  assert.equal(resultado.success, false);
  if (!resultado.success) {
    assert.match(resultado.error.issues[0]!.message, /futuro/i);
  }
});

test("DiaIsoSchema rechaza un formato incorrecto o un día inexistente", () => {
  assert.equal(DiaIsoSchema.safeParse("15/10/2026").success, false);
  assert.equal(DiaIsoSchema.safeParse("2026-2-1").success, false);
  assert.equal(DiaIsoSchema.safeParse("2026-02-30").success, false);
});

// ── Registro de saldo ─────────────────────────────────────────────────────────

test("RegistrarSaldoDiarioSchema acepta un saldo con 0, 1 o 2 decimales (y negativos)", () => {
  const base = { cuenta_id: "banco-nacion-cc-principal", fecha: "2000-01-01" };
  for (const saldo of ["0", "0.00", "1250000.00", "-1500.5", "480500.75"]) {
    assert.equal(
      RegistrarSaldoDiarioSchema.safeParse({ ...base, saldo }).success,
      true,
      `debería aceptar ${saldo}`,
    );
  }
});

test("RegistrarSaldoDiarioSchema RECHAZA el 3.º decimal (nunca redondea)", () => {
  const resultado = RegistrarSaldoDiarioSchema.safeParse({
    cuenta_id: "caja-chica-central",
    fecha: "2000-01-01",
    saldo: "100.123",
  });
  assert.equal(resultado.success, false);
  if (!resultado.success) {
    const issue = resultado.error.issues.find((i) => i.path[0] === "saldo");
    assert.ok(issue, "el error apunta al campo saldo");
    assert.match(issue!.message, /2 decimales|decimales/i);
  }
});

test("RegistrarSaldoDiarioSchema exige cuenta no vacía y un día válido", () => {
  assert.equal(
    RegistrarSaldoDiarioSchema.safeParse({ cuenta_id: "", fecha: "2000-01-01", saldo: "1.00" }).success,
    false,
  );
  assert.equal(
    RegistrarSaldoDiarioSchema.safeParse({
      cuenta_id: "banco-nacion-cc-principal",
      fecha: diaRelativo(1),
      saldo: "1.00",
    }).success,
    false,
  );
});
