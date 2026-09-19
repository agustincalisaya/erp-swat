import assert from "node:assert/strict";
import test from "node:test";
import {
  CrearPresupuestoSchema,
  PresupuestoIdSchema,
  AutorizarOverrideDescuentoSchema,
  PedidoVentaIdSchema,
  RegistrarOperacionCuentaCorrienteSchema,
  ResolverExcepcionCreditoSchema,
  ClienteCuentaCorrienteIdSchema,
  OperacionCuentaCorrienteIdSchema,
} from "./ventas.schema.ts";

const cliente = "11111111-1111-4111-8111-111111111111";
const variante = "22222222-2222-4222-8222-222222222222";
const deposito = "33333333-3333-4333-8333-333333333333";
const supervisor = "44444444-4444-4444-8444-444444444444";

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

// ── AutorizarOverrideDescuentoSchema (HU-B4, spec_modulo_B.md §2.4) ─────────

function overrideValido(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    variante_sku_id: variante,
    descuento_porcentual_solicitado: 12.5,
    motivo: "Cliente institucional",
    supervisor_credencial: { usuario_id: supervisor },
    ...overrides,
  };
}

test("AutorizarOverrideDescuentoSchema acepta un override válido vía descuento_porcentual_solicitado", () => {
  const resultado = AutorizarOverrideDescuentoSchema.safeParse(overrideValido());
  assert.equal(resultado.success, true);
});

test("AutorizarOverrideDescuentoSchema acepta un override válido vía precio_lista_modificado", () => {
  const resultado = AutorizarOverrideDescuentoSchema.safeParse(
    overrideValido({ descuento_porcentual_solicitado: undefined, precio_lista_modificado: 38000 }),
  );
  assert.equal(resultado.success, true);
});

test("AutorizarOverrideDescuentoSchema acepta ambos campos a la vez (el .refine no los excluye mutuamente)", () => {
  const resultado = AutorizarOverrideDescuentoSchema.safeParse(
    overrideValido({ precio_lista_modificado: 38000 }),
  );
  assert.equal(resultado.success, true);
});

test("AutorizarOverrideDescuentoSchema rechaza cuando NI descuento_porcentual_solicitado NI precio_lista_modificado vienen presentes", () => {
  const resultado = AutorizarOverrideDescuentoSchema.safeParse(
    overrideValido({ descuento_porcentual_solicitado: undefined }),
  );
  assert.equal(resultado.success, false);
  if (!resultado.success) {
    assert.equal(resultado.error.issues[0]?.path[0], "descuento_porcentual_solicitado");
  }
});

test("AutorizarOverrideDescuentoSchema exige motivo no vacío", () => {
  assert.equal(
    AutorizarOverrideDescuentoSchema.safeParse(overrideValido({ motivo: "" })).success,
    false,
  );
});

test("AutorizarOverrideDescuentoSchema rechaza descuento_porcentual_solicitado fuera de [0, 100]", () => {
  assert.equal(
    AutorizarOverrideDescuentoSchema.safeParse(overrideValido({ descuento_porcentual_solicitado: -1 })).success,
    false,
  );
  assert.equal(
    AutorizarOverrideDescuentoSchema.safeParse(overrideValido({ descuento_porcentual_solicitado: 101 })).success,
    false,
  );
});

test("AutorizarOverrideDescuentoSchema rechaza precio_lista_modificado no positivo", () => {
  assert.equal(
    AutorizarOverrideDescuentoSchema.safeParse(
      overrideValido({ descuento_porcentual_solicitado: undefined, precio_lista_modificado: 0 }),
    ).success,
    false,
  );
});

test("AutorizarOverrideDescuentoSchema exige supervisor_credencial.usuario_id como UUID", () => {
  assert.equal(
    AutorizarOverrideDescuentoSchema.safeParse(
      overrideValido({ supervisor_credencial: { usuario_id: "no-es-uuid" } }),
    ).success,
    false,
  );
});

test("AutorizarOverrideDescuentoSchema acepta variante_sku_id ausente (opcional — el servicio resuelve el ítem único pendiente)", () => {
  const resultado = AutorizarOverrideDescuentoSchema.safeParse(
    overrideValido({ variante_sku_id: undefined }),
  );
  assert.equal(resultado.success, true);
});

// ── PedidoVentaIdSchema ───────────────────────────────────────────────────────

test("PedidoVentaIdSchema valida el UUID del segmento [id]", () => {
  assert.equal(PedidoVentaIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(PedidoVentaIdSchema.safeParse(cliente).success, true);
});

// ── HU-B5 — RegistrarOperacionCuentaCorrienteSchema ─────────────────────────

test("RegistrarOperacionCuentaCorrienteSchema acepta pedido + monto positivo sin plan_de_pagos", () => {
  assert.equal(
    RegistrarOperacionCuentaCorrienteSchema.safeParse({ pedido_venta_id: cliente, monto: 1500.5 }).success,
    true,
  );
});

test("RegistrarOperacionCuentaCorrienteSchema rechaza monto 0/negativo y pedido_venta_id no-uuid", () => {
  assert.equal(RegistrarOperacionCuentaCorrienteSchema.safeParse({ pedido_venta_id: cliente, monto: 0 }).success, false);
  assert.equal(RegistrarOperacionCuentaCorrienteSchema.safeParse({ pedido_venta_id: cliente, monto: -5 }).success, false);
  assert.equal(RegistrarOperacionCuentaCorrienteSchema.safeParse({ pedido_venta_id: "x", monto: 5 }).success, false);
});

test("RegistrarOperacionCuentaCorrienteSchema valida cada hito del plan_de_pagos y coacciona fecha_estimada a Date", () => {
  const ok = RegistrarOperacionCuentaCorrienteSchema.safeParse({
    pedido_venta_id: cliente,
    monto: 100,
    plan_de_pagos: [{ hito: "Entrega parcial", porcentaje: 50, fecha_estimada: "2026-10-01" }],
  });
  assert.equal(ok.success, true);
  if (ok.success) assert.ok(ok.data.plan_de_pagos?.[0]?.fecha_estimada instanceof Date);

  const base = { pedido_venta_id: cliente, monto: 100 };
  assert.equal(RegistrarOperacionCuentaCorrienteSchema.safeParse({ ...base, plan_de_pagos: [{ hito: "", porcentaje: 10 }] }).success, false);
  assert.equal(RegistrarOperacionCuentaCorrienteSchema.safeParse({ ...base, plan_de_pagos: [{ hito: "h", porcentaje: 0 }] }).success, false);
  assert.equal(RegistrarOperacionCuentaCorrienteSchema.safeParse({ ...base, plan_de_pagos: [{ hito: "h", porcentaje: 101 }] }).success, false);
});

// ── HU-B5 — ResolverExcepcionCreditoSchema ──────────────────────────────────

test("ResolverExcepcionCreditoSchema acepta APROBAR/RECHAZAR con motivo", () => {
  assert.equal(ResolverExcepcionCreditoSchema.safeParse({ decision: "APROBAR", motivo: "ok" }).success, true);
  assert.equal(ResolverExcepcionCreditoSchema.safeParse({ decision: "RECHAZAR", motivo: "no" }).success, true);
});

test("ResolverExcepcionCreditoSchema exige motivo no vacío y decision dentro del enum", () => {
  const sinMotivo = ResolverExcepcionCreditoSchema.safeParse({ decision: "APROBAR", motivo: "" });
  assert.equal(sinMotivo.success, false);
  if (!sinMotivo.success) assert.equal(sinMotivo.error.issues[0]?.message, "El motivo es obligatorio");
  assert.equal(ResolverExcepcionCreditoSchema.safeParse({ decision: "TAL_VEZ", motivo: "x" }).success, false);
  assert.equal(ResolverExcepcionCreditoSchema.safeParse({ decision: "APROBAR" }).success, false);
});

test("ClienteCuentaCorrienteIdSchema y OperacionCuentaCorrienteIdSchema validan UUID de path param", () => {
  assert.equal(ClienteCuentaCorrienteIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(ClienteCuentaCorrienteIdSchema.safeParse(cliente).success, true);
  assert.equal(OperacionCuentaCorrienteIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(OperacionCuentaCorrienteIdSchema.safeParse(cliente).success, true);
});
