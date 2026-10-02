import assert from "node:assert/strict";
import test from "node:test";
import {
  ColaPreparacionQuerySchema,
  PedidoPickPackIdSchema,
  ConfirmarItemPreparacionSchema,
  PriorizarPedidoSchema,
  TomarPedidoSchema,
  CompletarPreparacionSchema,
} from "./pick-pack.schema.ts";

const UUID_VALIDO = "11111111-1111-4111-8111-111111111111";

// ── ColaPreparacionQuerySchema ───────────────────────────────────────────────

test("ColaPreparacionQuerySchema acepta query vacía con defaults", () => {
  const resultado = ColaPreparacionQuerySchema.safeParse({});
  assert.equal(resultado.success, true);
  if (resultado.success) {
    assert.equal(resultado.data.page, 1);
    assert.equal(resultado.data.page_size, 20);
  }
});

test("ColaPreparacionQuerySchema acepta page/page_size válidos", () => {
  const resultado = ColaPreparacionQuerySchema.safeParse({ page: 2, page_size: 50 });
  assert.equal(resultado.success, true);
  if (resultado.success) {
    assert.equal(resultado.data.page, 2);
    assert.equal(resultado.data.page_size, 50);
  }
});

test("ColaPreparacionQuerySchema acepta strings numéricos provenientes de URLSearchParams", () => {
  const resultado = ColaPreparacionQuerySchema.safeParse({ page: "2", page_size: "20" });
  assert.equal(resultado.success, true);
  if (resultado.success) {
    assert.equal(resultado.data.page, 2);
    assert.equal(resultado.data.page_size, 20);
  }
});

test("ColaPreparacionQuerySchema rechaza page/page_size inválidos", () => {
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page: -1 }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page: "abc" }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: 0 }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: "0" }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: -10 }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: "-1" }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: 51 }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: "51" }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: 10.5 }).success, false);
  assert.equal(ColaPreparacionQuerySchema.safeParse({ page_size: "2.5" }).success, false);
});

// ── PedidoPickPackIdSchema ───────────────────────────────────────────────────

test("PedidoPickPackIdSchema acepta un UUID válido", () => {
  assert.equal(PedidoPickPackIdSchema.safeParse(UUID_VALIDO).success, true);
});

test("PedidoPickPackIdSchema rechaza IDs inválidos", () => {
  assert.equal(PedidoPickPackIdSchema.safeParse("no-uuid").success, false);
  assert.equal(PedidoPickPackIdSchema.safeParse("").success, false);
  assert.equal(PedidoPickPackIdSchema.safeParse("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz").success, false);
  assert.equal(PedidoPickPackIdSchema.safeParse("11111111-1111-1111-1111-11111111111").success, false);
});

// ── ConfirmarItemPreparacionSchema ───────────────────────────────────────────

test("ConfirmarItemPreparacionSchema acepta scan_id UUID y código no vacío", () => {
  const resultado = ConfirmarItemPreparacionSchema.safeParse({
    scan_id: UUID_VALIDO,
    codigo: "7791234567890",
  });
  assert.equal(resultado.success, true);
  if (resultado.success) {
    assert.equal(resultado.data.scan_id, UUID_VALIDO);
    assert.equal(resultado.data.codigo, "7791234567890");
  }
});

test("ConfirmarItemPreparacionSchema rechaza scan_id inválido, código vacío o campos extra", () => {
  assert.equal(
    ConfirmarItemPreparacionSchema.safeParse({ scan_id: "no-uuid", codigo: "ABC" }).success,
    false,
  );
  assert.equal(
    ConfirmarItemPreparacionSchema.safeParse({ scan_id: UUID_VALIDO, codigo: "" }).success,
    false,
  );
  assert.equal(
    ConfirmarItemPreparacionSchema.safeParse({ scan_id: UUID_VALIDO, codigo: "   " }).success,
    false,
  );
  assert.equal(
    ConfirmarItemPreparacionSchema.safeParse({
      scan_id: UUID_VALIDO,
      codigo: "ABC",
      operador_id: UUID_VALIDO,
    }).success,
    false,
  );
});

// ── PriorizarPedidoSchema ────────────────────────────────────────────────────

test("PriorizarPedidoSchema acepta 1, 100 y null explícito", () => {
  assert.equal(PriorizarPedidoSchema.safeParse({ prioridad_manual: 1 }).success, true);
  assert.equal(PriorizarPedidoSchema.safeParse({ prioridad_manual: 100 }).success, true);
  assert.equal(PriorizarPedidoSchema.safeParse({ prioridad_manual: null }).success, true);
});

test("PriorizarPedidoSchema rechaza valores inválidos y ausencia", () => {
  assert.equal(PriorizarPedidoSchema.safeParse({ prioridad_manual: 0 }).success, false);
  assert.equal(PriorizarPedidoSchema.safeParse({ prioridad_manual: 101 }).success, false);
  assert.equal(PriorizarPedidoSchema.safeParse({ prioridad_manual: 50.5 }).success, false);
  assert.equal(PriorizarPedidoSchema.safeParse({ prioridad_manual: "10" }).success, false);
  assert.equal(PriorizarPedidoSchema.safeParse({}).success, false);
  assert.equal(
    PriorizarPedidoSchema.safeParse({ prioridad_manual: 5, extra: true }).success,
    false,
  );
});

// ── TomarPedidoSchema / CompletarPreparacionSchema ───────────────────────────

test("TomarPedidoSchema y CompletarPreparacionSchema aceptan cuerpo vacío", () => {
  assert.equal(TomarPedidoSchema.safeParse({}).success, true);
  assert.equal(CompletarPreparacionSchema.safeParse({}).success, true);
});

test("TomarPedidoSchema y CompletarPreparacionSchema rechazan cualquier campo del cliente", () => {
  assert.equal(TomarPedidoSchema.safeParse({ operador_id: UUID_VALIDO }).success, false);
  assert.equal(CompletarPreparacionSchema.safeParse({ forzar: true }).success, false);
});
