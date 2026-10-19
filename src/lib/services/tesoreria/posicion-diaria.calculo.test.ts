/**
 * HU-G7 §9.8 — funciones PURAS de la posición diaria
 * (`posicion-diaria.calculo.ts`). Runner nativo de Node:
 * `node --experimental-strip-types --test <este archivo>`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";

import {
  agruparEgresosProyectados,
  calcularCajaVirtual,
  corteCajaHasta,
  corteSaldoDia,
  type CuentaProyectada,
  elegirSaldoVigente,
  formatMonto,
  type OperacionPlan,
  proyectarHitosPlanPagos,
  sumarDecimales,
  totalLiquido,
} from "./posicion-diaria.calculo.ts";
import { inicioDiaUtc, rangoDiasNegocio } from "../../utils/fecha-negocio.ts";

const dec = (valor: string) => new Prisma.Decimal(valor);

// ── Cortes temporales ─────────────────────────────────────────────────────────

test("corteSaldoDia es la medianoche UTC del día (convención fecha-solo)", () => {
  assert.equal(corteSaldoDia("2026-10-15").getTime(), inicioDiaUtc("2026-10-15").getTime());
  assert.equal(corteSaldoDia("2026-10-15").toISOString(), "2026-10-15T00:00:00.000Z");
});

test("corteCajaHasta es la medianoche de Argentina del día siguiente (semiabierto)", () => {
  const hasta = corteCajaHasta("2026-10-15");
  assert.equal(hasta.getTime(), rangoDiasNegocio("2026-10-15", "2026-10-15").hasta.getTime());
  // 23:59 del 15/10 en Argentina está DENTRO; 00:00 del 16/10 en Argentina queda FUERA.
  assert.ok(new Date("2026-10-16T02:59:59.999Z").getTime() < hasta.getTime());
  assert.ok(!(new Date("2026-10-16T03:00:00.000Z").getTime() < hasta.getTime()));
});

// ── G7-3 — saldo vigente ──────────────────────────────────────────────────────

const asiento = (id: string, cuenta_id: string, fecha: string, created_at: string, saldo: string) => ({
  id,
  cuenta_id,
  fecha: new Date(fecha),
  created_at: new Date(created_at),
  saldo: dec(saldo),
});

test("elegirSaldoVigente: incluye el asiento del mismo día del corte (fecha == corte)", () => {
  const mapa = elegirSaldoVigente(
    [asiento("a", "c1", "2026-10-15T00:00:00.000Z", "2026-10-15T10:00:00.000Z", "100.00")],
    "2026-10-15",
  );
  assert.equal(mapa.get("c1")?.saldo.toFixed(2), "100.00");
});

test("elegirSaldoVigente: un asiento del día siguiente NO entra", () => {
  const mapa = elegirSaldoVigente(
    [asiento("a", "c1", "2026-10-16T00:00:00.000Z", "2026-10-16T00:00:00.000Z", "100.00")],
    "2026-10-15",
  );
  assert.equal(mapa.has("c1"), false);
});

test("elegirSaldoVigente: sin asiento hasta el corte la cuenta NO aparece (no se presume cero)", () => {
  const mapa = elegirSaldoVigente([], "2026-10-15");
  assert.equal(mapa.size, 0);
  assert.equal(mapa.get("c1"), undefined);
});

test("elegirSaldoVigente: prevalece la fecha mayor; empate del día: mayor created_at; empate total: mayor id", () => {
  const mapa = elegirSaldoVigente(
    [
      asiento("b", "c1", "2026-10-10T00:00:00.000Z", "2026-10-10T10:00:00.000Z", "10.00"),
      // Mismo día (10/10): gana el de mayor created_at.
      asiento("a", "c1", "2026-10-10T00:00:00.000Z", "2026-10-10T11:00:00.000Z", "20.00"),
      // Mismo día y mismo created_at: gana el id mayor ("z" > "a").
      asiento("z", "c1", "2026-10-10T00:00:00.000Z", "2026-10-10T11:00:00.000Z", "30.00"),
      // Día posterior: gana siempre.
      asiento("m", "c1", "2026-10-12T00:00:00.000Z", "2026-10-12T00:00:00.000Z", "40.00"),
    ],
    "2026-10-15",
  );
  assert.equal(mapa.get("c1")?.saldo.toFixed(2), "40.00");
  assert.equal(mapa.get("c1")?.fecha.toISOString(), "2026-10-12T00:00:00.000Z");
});

test("elegirSaldoVigente: múltiples cuentas, cada una con su último asiento", () => {
  const mapa = elegirSaldoVigente(
    [
      asiento("a1", "c1", "2026-10-10T00:00:00.000Z", "2026-10-10T00:00:00.000Z", "10.00"),
      asiento("a2", "c1", "2026-10-11T00:00:00.000Z", "2026-10-11T00:00:00.000Z", "11.00"),
      asiento("b1", "c2", "2026-10-11T00:00:00.000Z", "2026-10-11T00:00:00.000Z", "22.00"),
    ],
    "2026-10-15",
  );
  assert.equal(mapa.get("c1")?.saldo.toFixed(2), "11.00");
  assert.equal(mapa.get("c2")?.saldo.toFixed(2), "22.00");
});

// ── G7-5 — caja virtual ───────────────────────────────────────────────────────

test("calcularCajaVirtual: Σingresos − Σcontra, listas vacías ⇒ 0", () => {
  assert.equal(calcularCajaVirtual([], []).toFixed(2), "0.00");
  assert.equal(
    calcularCajaVirtual([{ monto: dec("100.00") }, { monto: dec("50.50") }], [{ monto: dec("20.00") }]).toFixed(2),
    "130.50",
  );
});

test("calcularCajaVirtual: puede dar NEGATIVO (reintegros sin ingreso neto), sin clamp", () => {
  const caja = calcularCajaVirtual([{ monto: dec("10.00") }], [{ monto: dec("35.00") }]);
  assert.equal(caja.toFixed(2), "-25.00");
});

test("calcularCajaVirtual: suma exacta (0.10 + 0.20 = 0.30) sin pasar por float", () => {
  assert.equal(
    calcularCajaVirtual([{ monto: dec("0.10") }, { monto: dec("0.20") }], []).toFixed(2),
    "0.30",
  );
});

// ── G7-7 — egresos proyectados ────────────────────────────────────────────────

const cpp = (id: string, estado: "DEFINITIVA" | "PROVISORIO", monto: string, fecha: string | null): CuentaProyectada => ({
  id,
  estado,
  monto: dec(monto),
  fecha_vencimiento: fecha === null ? null : new Date(fecha),
});

test("agruparEgresosProyectados: separa DEFINITIVA y PROVISORIO en dos bloques", () => {
  const r = agruparEgresosProyectados([
    cpp("d", "DEFINITIVA", "100.00", "2026-10-20T00:00:00.000Z"),
    cpp("p", "PROVISORIO", "200.00", "2026-10-20T00:00:00.000Z"),
  ]);
  assert.equal(r.definitivas.length, 1);
  assert.equal(r.provisorias.length, 1);
  assert.equal(r.definitivas[0]!.subtotal.toFixed(2), "100.00");
  assert.equal(r.provisorias[0]!.subtotal.toFixed(2), "200.00");
});

test("agruparEgresosProyectados: agrupa por fecha de vencimiento y ordena por fecha", () => {
  const r = agruparEgresosProyectados([
    cpp("d2", "DEFINITIVA", "10.00", "2026-10-20T00:00:00.000Z"),
    cpp("d1", "DEFINITIVA", "20.00", "2026-10-10T00:00:00.000Z"),
    cpp("d3", "DEFINITIVA", "30.00", "2026-10-10T00:00:00.000Z"),
  ]);
  assert.deepEqual(
    r.definitivas.map((g) => [g.fecha_vencimiento, g.subtotal.toFixed(2), g.cuentas.length]),
    [
      ["2026-10-10", "50.00", 2],
      ["2026-10-20", "10.00", 1],
    ],
  );
});

test("agruparEgresosProyectados: vencimiento null forma su PROPIO grupo, al final", () => {
  const r = agruparEgresosProyectados([
    cpp("d0", "DEFINITIVA", "5.00", null),
    cpp("d1", "DEFINITIVA", "10.00", "2026-10-10T00:00:00.000Z"),
  ]);
  const ultimo = r.definitivas[r.definitivas.length - 1]!;
  assert.equal(ultimo.fecha_vencimiento, null);
  assert.equal(ultimo.subtotal.toFixed(2), "5.00");
});

test("agruparEgresosProyectados: total_definitivas suma SOLO las DEFINITIVA", () => {
  const r = agruparEgresosProyectados([
    cpp("d1", "DEFINITIVA", "100.00", null),
    cpp("d2", "DEFINITIVA", "50.50", null),
    cpp("p1", "PROVISORIO", "999.00", null),
  ]);
  assert.equal(r.total_definitivas.toFixed(2), "150.50");
});

test("agruparEgresosProyectados: listas vacías ⇒ dos bloques vacíos y total 0", () => {
  const r = agruparEgresosProyectados([]);
  assert.deepEqual(r.definitivas, []);
  assert.deepEqual(r.provisorias, []);
  assert.equal(r.total_definitivas.toFixed(2), "0.00");
});

// ── G7-8 — hitos del plan de pagos ────────────────────────────────────────────

const op = (id: string, monto: string, plan: unknown): OperacionPlan => ({
  cuenta_corriente_id: id,
  monto: dec(monto),
  plan_de_pagos: plan,
});

test("proyectarHitosPlanPagos: importe = monto × porcentaje / 100 con escala 2", () => {
  const hitos = proyectarHitosPlanPagos([
    op("cc1", "1000.00", [{ hito: "Seña", porcentaje: 30, fecha_estimada: "2026-11-01" }]),
  ]);
  assert.deepEqual(
    hitos.map((h) => [h.cuenta_corriente_id, h.hito, h.porcentaje, h.importe.toFixed(2), h.fecha_estimada]),
    [["cc1", "Seña", 30, "300.00", "2026-11-01"]],
  );
});

test("proyectarHitosPlanPagos: un hito SIN fecha_estimada queda EXCLUIDO", () => {
  const hitos = proyectarHitosPlanPagos([
    op("cc1", "1000.00", [
      { hito: "Sin fecha", porcentaje: 50 },
      { hito: "Con fecha", porcentaje: 50, fecha_estimada: "2026-12-01" },
    ]),
  ]);
  assert.deepEqual(hitos.map((h) => h.hito), ["Con fecha"]);
});

test("proyectarHitosPlanPagos: plan malformado (no lista / hitos inválidos) se ignora sin romper", () => {
  assert.deepEqual(proyectarHitosPlanPagos([op("cc1", "1000.00", { no: "lista" })]), []);
  assert.deepEqual(proyectarHitosPlanPagos([op("cc1", "1000.00", null)]), []);
  assert.deepEqual(
    proyectarHitosPlanPagos([op("cc1", "1000.00", ["texto", 42, { hito: "", porcentaje: 10 }])]),
    [],
  );
});

// ── Totales y formato ─────────────────────────────────────────────────────────

test("sumarDecimales y totalLiquido: vacío ⇒ 0; total = Σsaldos + caja", () => {
  assert.equal(sumarDecimales([]).toFixed(2), "0.00");
  assert.equal(
    totalLiquido(
      [{ cuenta_id: "c1", saldo: dec("100.00"), fecha: new Date() }],
      dec("25.00"),
    ).toFixed(2),
    "125.00",
  );
  assert.equal(totalLiquido([], dec("0.00")).toFixed(2), "0.00");
});

test("formatMonto serializa con exactamente 2 decimales", () => {
  assert.equal(formatMonto(dec("1250000")), "1250000.00");
  assert.equal(formatMonto(dec("-25.5")), "-25.50");
});

// ── G7-6 — TurnoCaja fuera por diseño (negativo estructural) ──────────────────

test("el módulo de cálculo NO referencia TurnoCaja ni saldo_esperado", () => {
  const fuente = readFileSync(new URL("./posicion-diaria.calculo.ts", import.meta.url), "utf8");
  assert.ok(!/turnoCaja/i.test(fuente), "no debe leer TurnoCaja");
  assert.ok(!/saldo_esperado/i.test(fuente), "no debe exponer saldo_esperado");
});
