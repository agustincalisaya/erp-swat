/**
 * HU-E15 — Nivel 1 (unit, sin DB): plazo de la reserva en minutos y su
 * degradación sin configuración (docs/modulos/modulo E/HU15_TASKS.md T01).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  derivarEstadoVisiblePedidoWeb,
  minutosDePlazoCheckout,
  minutosRestantesReserva,
  resolverPlazoCheckoutMinutos,
} from "./pedido-web.reglas.ts";

const ahora = new Date("2026-10-20T15:00:00.000Z");
const mas = (ms: number) => new Date(ahora.getTime() + ms);

// ── E15-2: horas → minutos ────────────────────────────────────────────────────

test("E15-2 — el plazo se informa en minutos (horas × 60)", () => {
  assert.equal(minutosDePlazoCheckout(1), 60);
  assert.equal(minutosDePlazoCheckout(24), 1440);
});

// ── E15-4: minutos restantes (Math.ceil) en los bordes del TTL ───────────────

test("E15-4 — minutos restantes antes del TTL se redondean hacia arriba", () => {
  assert.equal(minutosRestantesReserva(mas(61_000), ahora), 2);
  assert.equal(minutosRestantesReserva(mas(60_000), ahora), 1);
  assert.equal(minutosRestantesReserva(mas(1), ahora), 1);
});

test("E15-4/E15-7 — en el TTL exacto y después, los minutos son <= 0", () => {
  assert.equal(minutosRestantesReserva(ahora, ahora), 0);
  assert.ok(minutosRestantesReserva(mas(-1), ahora) <= 0);
  assert.ok(minutosRestantesReserva(mas(-60_001), ahora) < 0);
});

test("E15-4/E15-7 — 'minutos <= 0' equivale a RESERVA_VENCIDA en los mismos bordes", () => {
  for (const delta of [61_000, 60_000, 1, 0, -1, -60_001]) {
    const ttl = mas(delta);
    const vencidaPorMinutos = minutosRestantesReserva(ttl, ahora) <= 0;
    const vencidaPorEstado = derivarEstadoVisiblePedidoWeb(ttl, ahora) === "RESERVA_VENCIDA";
    assert.equal(vencidaPorMinutos, vencidaPorEstado, `delta ${delta} ms`);
  }
});

// ── E15-2 / D2 (C2): degradación sin default ─────────────────────────────────

const errorConCodigo = (code: string) => Object.assign(new Error(code), { code });

test("D2 — con configuración válida devuelve los minutos", async () => {
  assert.equal(await resolverPlazoCheckoutMinutos(async () => 1), 60);
});

test("D2/C2 — CONFIGURACION_INVALIDA y CONFIGURACION_NO_ENCONTRADA → null (texto genérico, sin default)", async (t) => {
  t.mock.method(console, "error", () => {});
  assert.equal(await resolverPlazoCheckoutMinutos(async () => { throw errorConCodigo("CONFIGURACION_INVALIDA"); }), null);
  assert.equal(await resolverPlazoCheckoutMinutos(async () => { throw errorConCodigo("CONFIGURACION_NO_ENCONTRADA"); }), null);
});

test("D2/C2 — el log de la degradación lleva solo el código, nunca la clave ni el valor", async (t) => {
  const mensajes: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { mensajes.push(args.join(" ")); });
  const error = Object.assign(new Error('ECOMMERCE_CHECKOUT_TTL_HORAS debe ser un entero positivo (valor actual: "x")'), {
    code: "CONFIGURACION_INVALIDA",
  });
  await resolverPlazoCheckoutMinutos(async () => { throw error; });
  assert.equal(mensajes.length, 1);
  assert.match(mensajes[0], /CONFIGURACION_INVALIDA/);
  assert.doesNotMatch(mensajes[0], /ECOMMERCE_CHECKOUT_TTL_HORAS|valor actual/);
});

test("D2/C2 — cualquier otro error se propaga", async () => {
  await assert.rejects(
    resolverPlazoCheckoutMinutos(async () => { throw errorConCodigo("P1001"); }),
    (e: unknown) => (e as { code?: string }).code === "P1001",
  );
  await assert.rejects(resolverPlazoCheckoutMinutos(async () => { throw new TypeError("boom"); }), TypeError);
});
