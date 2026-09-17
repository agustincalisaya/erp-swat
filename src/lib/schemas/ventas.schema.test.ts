import assert from "node:assert/strict";
import test from "node:test";
import { CrearPresupuestoSchema, PresupuestoIdSchema } from "./ventas.schema.ts";

const cliente = "11111111-1111-4111-8111-111111111111";
const variante = "22222222-2222-4222-8222-222222222222";
const deposito = "33333333-3333-4333-8333-333333333333";

function itemValido(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    variante_sku_id: variante,
    deposito_id: deposito,
    cantidad: 5,
    precio_cotizado: 38000,
    ...overrides,
  };
}

function presupuestoValido(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    cliente_id: cliente,
    vigencia_dias: 7,
    items: [itemValido()],
    ...overrides,
  };
}

// ── CrearPresupuestoSchema ───────────────────────────────────────────────────

test("CrearPresupuestoSchema acepta un alta mínima válida y default origen_reserva a LICITACION", () => {
  const resultado = CrearPresupuestoSchema.safeParse(presupuestoValido());
  assert.equal(resultado.success, true);
  if (resultado.success) {
    assert.equal(resultado.data.origen_reserva, "LICITACION");
  }
});

test("CrearPresupuestoSchema acepta condiciones_comerciales opcional y origen_reserva explícito", () => {
  const resultado = CrearPresupuestoSchema.safeParse(
    presupuestoValido({
      condiciones_comerciales: "Pago contra entrega",
      origen_reserva: "PEDIDO_INSTITUCIONAL",
    }),
  );
  assert.equal(resultado.success, true);
  if (resultado.success) {
    assert.equal(resultado.data.origen_reserva, "PEDIDO_INSTITUCIONAL");
    assert.equal(resultado.data.condiciones_comerciales, "Pago contra entrega");
  }
});

test("CrearPresupuestoSchema rechaza un origen_reserva fuera de LICITACION/PEDIDO_INSTITUCIONAL (SENIA excluido a propósito)", () => {
  // SENIA es un origen válido en Módulo A (spec_modulo_A.md §2.9) pero no
  // aplica a una cotización institucional de HU-B3 (spec_modulo_B.md §2.3
  // solo menciona LICITACION/PEDIDO_INSTITUCIONAL para este flujo).
  assert.equal(
    CrearPresupuestoSchema.safeParse(presupuestoValido({ origen_reserva: "SENIA" })).success,
    false,
  );
  assert.equal(
    CrearPresupuestoSchema.safeParse(presupuestoValido({ origen_reserva: "OTRO" })).success,
    false,
  );
});

test("CrearPresupuestoSchema exige al menos un ítem", () => {
  assert.equal(CrearPresupuestoSchema.safeParse(presupuestoValido({ items: [] })).success, false);
});

test("CrearPresupuestoSchema exige deposito_id por ítem (extensión autorizada al contrato de spec §2.3)", () => {
  const item = itemValido();
  delete (item as Record<string, unknown>).deposito_id;
  assert.equal(
    CrearPresupuestoSchema.safeParse(presupuestoValido({ items: [item] })).success,
    false,
  );
  assert.equal(
    CrearPresupuestoSchema.safeParse(
      presupuestoValido({ items: [itemValido({ deposito_id: "no-es-uuid" })] }),
    ).success,
    false,
  );
});

test("CrearPresupuestoSchema rechaza cantidad y precio_cotizado no positivos", () => {
  for (const cantidad of [0, -1, 1.5]) {
    assert.equal(
      CrearPresupuestoSchema.safeParse(presupuestoValido({ items: [itemValido({ cantidad })] }))
        .success,
      false,
    );
  }
  for (const precio_cotizado of [0, -100]) {
    assert.equal(
      CrearPresupuestoSchema.safeParse(
        presupuestoValido({ items: [itemValido({ precio_cotizado })] }),
      ).success,
      false,
    );
  }
});

test("CrearPresupuestoSchema rechaza vigencia_dias no entera o no positiva", () => {
  for (const vigencia_dias of [0, -3, 2.5]) {
    assert.equal(
      CrearPresupuestoSchema.safeParse(presupuestoValido({ vigencia_dias })).success,
      false,
    );
  }
});

test("CrearPresupuestoSchema rechaza cliente_id que no sea UUID", () => {
  assert.equal(
    CrearPresupuestoSchema.safeParse(presupuestoValido({ cliente_id: "no-es-uuid" })).success,
    false,
  );
});

// ── PresupuestoIdSchema ───────────────────────────────────────────────────────

test("PresupuestoIdSchema valida el UUID del segmento [id]", () => {
  assert.equal(PresupuestoIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(PresupuestoIdSchema.safeParse(cliente).success, true);
});
