import assert from "node:assert/strict";
import test from "node:test";

import {
  AnularComprobanteProveedorSchema,
  RegistrarComprobanteProveedorSchema,
} from "../../schemas/comprobantes-proveedor.schema.ts";
import {
  construirClaveUnicidadComprobante,
  ESTADOS_OC_ADMITEN_COMPROBANTE,
  evaluarAnulacion,
  ordenCompraAdmiteComprobante,
  resolverProveedorIdDeOrden,
} from "./comprobante-proveedor-reglas.ts";

const PROVEEDOR_ID = "11111111-1111-4111-8111-111111111111";

// ──────────────────────────────────────────────────────────────────────────────
// Precondición de estado de la OC (spec §2.7)
// ──────────────────────────────────────────────────────────────────────────────

test("ordenCompraAdmiteComprobante: RECIBIDA_COMPLETA y CERRADA activas lo admiten", () => {
  for (const estado of ESTADOS_OC_ADMITEN_COMPROBANTE) {
    assert.equal(
      ordenCompraAdmiteComprobante({ estado, is_active: true, deleted_at: null }),
      true,
      `${estado} debería admitir comprobante`,
    );
  }
});

test("ordenCompraAdmiteComprobante: todo estado anterior a RECIBIDA_COMPLETA lo rechaza", () => {
  for (const estado of ["BORRADOR", "ENVIADA", "CONFIRMADA", "RECEPCION_PARCIAL"] as const) {
    assert.equal(
      ordenCompraAdmiteComprobante({ estado, is_active: true, deleted_at: null }),
      false,
      `${estado} no debería admitir comprobante`,
    );
  }
});

test("ordenCompraAdmiteComprobante: CANCELADA queda explícitamente excluida", () => {
  assert.equal(
    ordenCompraAdmiteComprobante({ estado: "CANCELADA", is_active: true, deleted_at: null }),
    false,
  );
});

test("ordenCompraAdmiteComprobante: una OC dada de baja lógica nunca lo admite, aunque el estado sea válido", () => {
  assert.equal(
    ordenCompraAdmiteComprobante({
      estado: "RECIBIDA_COMPLETA",
      is_active: false,
      deleted_at: new Date(),
    }),
    false,
  );
  assert.equal(
    ordenCompraAdmiteComprobante({
      estado: "CERRADA",
      is_active: true,
      deleted_at: new Date(),
    }),
    false,
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Resolución server-side de proveedor_id (spec §2.7 / §2.7.1)
// ──────────────────────────────────────────────────────────────────────────────

test("resolverProveedorIdDeOrden: siempre devuelve el proveedor_id de la OC (congelado)", () => {
  assert.equal(resolverProveedorIdDeOrden({ proveedor_id: PROVEEDOR_ID }), PROVEEDOR_ID);
});

// ──────────────────────────────────────────────────────────────────────────────
// Clave de unicidad compuesta (numero + tipo + proveedor) — espeja el @@unique
// ──────────────────────────────────────────────────────────────────────────────

test("construirClaveUnicidadComprobante: misma terna → misma clave; distinto tipo/numero/proveedor → distinta", () => {
  const base = {
    numero_comprobante: "0001-00012345",
    tipo: "FACTURA_A" as const,
    proveedor_id: PROVEEDOR_ID,
  };
  assert.equal(
    construirClaveUnicidadComprobante(base),
    construirClaveUnicidadComprobante({ ...base, numero_comprobante: " 0001-00012345 " }),
    "el trim del número no debe cambiar la clave",
  );
  assert.notEqual(
    construirClaveUnicidadComprobante(base),
    construirClaveUnicidadComprobante({ ...base, tipo: "FACTURA_B" }),
  );
  assert.notEqual(
    construirClaveUnicidadComprobante(base),
    construirClaveUnicidadComprobante({ ...base, numero_comprobante: "0001-00012346" }),
  );
  assert.notEqual(
    construirClaveUnicidadComprobante(base),
    construirClaveUnicidadComprobante({
      ...base,
      proveedor_id: "22222222-2222-4222-8222-222222222222",
    }),
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Transición de baja lógica (spec §3.6)
// ──────────────────────────────────────────────────────────────────────────────

test("evaluarAnulacion: un comprobante activo se puede anular", () => {
  assert.deepEqual(evaluarAnulacion({ is_active: true }), { ok: true });
});

test("evaluarAnulacion: un comprobante ya anulado → COMPROBANTE_YA_ANULADO (terminal)", () => {
  assert.deepEqual(evaluarAnulacion({ is_active: false }), {
    ok: false,
    code: "COMPROBANTE_YA_ANULADO",
  });
});

test("evaluarAnulacion: comprobante inexistente → COMPROBANTE_NO_ENCONTRADO", () => {
  assert.deepEqual(evaluarAnulacion(null), {
    ok: false,
    code: "COMPROBANTE_NO_ENCONTRADO",
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Schemas Zod — el cliente nunca envía orden_compra_id ni proveedor_id
// ──────────────────────────────────────────────────────────────────────────────

test("RegistrarComprobanteProveedorSchema: payload mínimo válido; coacciona fecha y monto", () => {
  const parsed = RegistrarComprobanteProveedorSchema.parse({
    tipo: "FACTURA_A",
    numero_comprobante: "0001-00012345",
    fecha_emision: "2026-09-01",
    monto_total: "1500.50",
  });
  assert.equal(parsed.tipo, "FACTURA_A");
  assert.ok(parsed.fecha_emision instanceof Date);
  assert.equal(parsed.monto_total, 1500.5);
  assert.equal(parsed.archivo_adjunto_url, undefined);
});

test("RegistrarComprobanteProveedorSchema: rechaza tipo fuera del enum, monto <= 0 y URL inválida", () => {
  assert.equal(
    RegistrarComprobanteProveedorSchema.safeParse({
      tipo: "FACTURA_X",
      numero_comprobante: "1",
      fecha_emision: "2026-09-01",
      monto_total: 10,
    }).success,
    false,
  );
  assert.equal(
    RegistrarComprobanteProveedorSchema.safeParse({
      tipo: "FACTURA_A",
      numero_comprobante: "1",
      fecha_emision: "2026-09-01",
      monto_total: 0,
    }).success,
    false,
  );
  assert.equal(
    RegistrarComprobanteProveedorSchema.safeParse({
      tipo: "FACTURA_A",
      numero_comprobante: "1",
      fecha_emision: "2026-09-01",
      monto_total: 10,
      archivo_adjunto_url: "no-es-una-url",
    }).success,
    false,
  );
});

test("RegistrarComprobanteProveedorSchema: numero_comprobante vacío o solo espacios es inválido", () => {
  assert.equal(
    RegistrarComprobanteProveedorSchema.safeParse({
      tipo: "FACTURA_A",
      numero_comprobante: "   ",
      fecha_emision: "2026-09-01",
      monto_total: 10,
    }).success,
    false,
  );
});

test("RegistrarComprobanteProveedorSchema: ignora claves no declaradas (orden_compra_id / proveedor_id del cliente)", () => {
  const parsed = RegistrarComprobanteProveedorSchema.parse({
    tipo: "FACTURA_B",
    numero_comprobante: "0002-1",
    fecha_emision: "2026-09-02",
    monto_total: 99.99,
    orden_compra_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    proveedor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  }) as Record<string, unknown>;
  assert.equal("orden_compra_id" in parsed, false);
  assert.equal("proveedor_id" in parsed, false);
});

test("AnularComprobanteProveedorSchema: exige deletion_reason no vacío", () => {
  assert.equal(AnularComprobanteProveedorSchema.safeParse({ deletion_reason: "Error de carga" }).success, true);
  assert.equal(AnularComprobanteProveedorSchema.safeParse({ deletion_reason: "  " }).success, false);
  assert.equal(AnularComprobanteProveedorSchema.safeParse({}).success, false);
});
