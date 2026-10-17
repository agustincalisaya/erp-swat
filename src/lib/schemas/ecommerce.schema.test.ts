/**
 * HU-E6 §2.6 — schemas Zod del log de auditoría de pagos online (R2/R4).
 * Validación pura, sin DB.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ESTADOS_PAGO_LOG,
  ListarLogPagosQuerySchema,
  SolicitarAccesoLogPagosSchema,
  AccesoLogPagosIdSchema,
} from "./ecommerce.schema.ts";

const uuid = "11111111-1111-4111-8111-111111111111";

// ── ListarLogPagosQuerySchema ───────────────────────────────────────────────

test("paginación: defaults 1/20 y tope 50", () => {
  const def = ListarLogPagosQuerySchema.parse({});
  assert.equal(def.page, 1);
  assert.equal(def.page_size, 20);
  assert.equal(ListarLogPagosQuerySchema.parse({ page: "3", page_size: "50" }).page, 3);
  assert.equal(ListarLogPagosQuerySchema.safeParse({ page_size: "51" }).success, false);
  assert.equal(ListarLogPagosQuerySchema.safeParse({ page: "0" }).success, false);
});

test("estado_pago: enum de 3 valores; cualquier otro es inválido", () => {
  for (const estado of ESTADOS_PAGO_LOG) {
    assert.equal(ListarLogPagosQuerySchema.safeParse({ estado_pago: estado }).success, true, estado);
  }
  assert.equal(ListarLogPagosQuerySchema.safeParse({ estado_pago: "ANULADO" }).success, false);
});

test("fecha_desde/fecha_hasta se coercionan a Date", () => {
  const q = ListarLogPagosQuerySchema.parse({ fecha_desde: "2026-01-01", fecha_hasta: "2026-01-31" });
  assert.ok(q.fecha_desde instanceof Date && q.fecha_hasta instanceof Date);
  assert.equal(ListarLogPagosQuerySchema.safeParse({ fecha_desde: "no-es-fecha" }).success, false);
});

// ── SolicitarAccesoLogPagosSchema ───────────────────────────────────────────

test("SolicitarAccesoLogPagosSchema acepta body vacío y motivo opcional válido", () => {
  assert.equal(SolicitarAccesoLogPagosSchema.safeParse({}).success, true);
  assert.equal(SolicitarAccesoLogPagosSchema.safeParse({ motivo: "Auditoría trimestral" }).success, true);
});

test("SolicitarAccesoLogPagosSchema rechaza motivo vacío, no-string, largo excesivo y campos extra", () => {
  assert.equal(SolicitarAccesoLogPagosSchema.safeParse({ motivo: "" }).success, false);
  assert.equal(SolicitarAccesoLogPagosSchema.safeParse({ motivo: 123 }).success, false);
  assert.equal(SolicitarAccesoLogPagosSchema.safeParse({ motivo: "x".repeat(501) }).success, false);
  assert.equal(SolicitarAccesoLogPagosSchema.safeParse({ estado: "APROBADO" }).success, false);
});

// ── AccesoLogPagosIdSchema ──────────────────────────────────────────────────

test("AccesoLogPagosIdSchema valida el UUID del segmento [id]", () => {
  assert.equal(AccesoLogPagosIdSchema.safeParse(uuid).success, true);
  assert.equal(AccesoLogPagosIdSchema.safeParse("no-es-uuid").success, false);
});
