/**
 * HU-E2 — reglas puras del pago web (CA3, CA5, P13, Q2, D-E2-5). Unit, sin DB.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  clasificarAprobadoSobreResuelto,
  esReferenciaValida,
  pagoCoincideConPedido,
  reservasVigentesParaConfirmar,
} from "./pago-web.reglas.ts";

test("external_reference: solo UUID", () => {
  assert.equal(esReferenciaValida("385f3f34-2984-4b69-aa63-c61458c3cc9e"), true);
  assert.equal(esReferenciaValida(null), false);
  assert.equal(esReferenciaValida(""), false);
  assert.equal(esReferenciaValida("pedido-123"), false);
});

test("monto: coincide al centavo y en ARS (P13)", () => {
  assert.equal(pagoCoincideConPedido("15210.00", 15210, "ARS"), true);
  assert.equal(pagoCoincideConPedido("15210.10", 15210.1, "ARS"), true);
  assert.equal(pagoCoincideConPedido("15210.00", 15209.99, "ARS"), false);
  assert.equal(pagoCoincideConPedido("15210.00", 15210, "USD"), false);
  assert.equal(pagoCoincideConPedido("0.30", 0.1 + 0.2, "ARS"), true);
});

test("reservas: todas abiertas y sin vencer (Q2)", () => {
  const ahora = new Date("2026-10-01T15:00:00Z");
  const futura = { fecha_expiracion: new Date("2026-10-01T16:00:00Z"), fecha_fin_reserva: null };
  const vencida = { fecha_expiracion: new Date("2026-10-01T14:59:59Z"), fecha_fin_reserva: null };
  const cerrada = { fecha_expiracion: new Date("2026-10-01T16:00:00Z"), fecha_fin_reserva: ahora };
  assert.equal(reservasVigentesParaConfirmar([futura, futura], ahora), true);
  assert.equal(reservasVigentesParaConfirmar([futura, vencida], ahora), false);
  assert.equal(reservasVigentesParaConfirmar([cerrada], ahora), false);
  assert.equal(reservasVigentesParaConfirmar([null], ahora), false);
  assert.equal(reservasVigentesParaConfirmar([], ahora), false);
});

test("aprobado sobre pedido ya resuelto (CA3, D-E2-5, Q2)", () => {
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_CONFIRMADO", "111", "111"), "SIN_EFECTO");
  assert.equal(clasificarAprobadoSobreResuelto("EN_PREPARACION", "111", "111"), "SIN_EFECTO");
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_CONFIRMADO", "111", "222"), "PAGO_DUPLICADO");
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_RECHAZADO", "111", "222"), "PAGO_TARDIO");
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_RECHAZADO", "111", "111"), "PAGO_TARDIO");
  assert.equal(clasificarAprobadoSobreResuelto("ANULADO", null, "222"), "PAGO_TARDIO");
});
