import assert from "node:assert/strict";
import test from "node:test";
import { MisPedidosQuerySchema, PedidoWebIdSchema } from "./mis-pedidos.schema.ts";

const UUID_VALIDO = "11111111-1111-4111-8111-111111111111";

test("MisPedidosQuerySchema aplica defaults sin parámetros", () => {
  assert.deepEqual(MisPedidosQuerySchema.parse({}), { page: 1, page_size: 20 });
});

test("MisPedidosQuerySchema acepta page y page_size válidos como números o query strings", () => {
  assert.deepEqual(MisPedidosQuerySchema.parse({ page: "2" }), { page: 2, page_size: 20 });
  assert.deepEqual(MisPedidosQuerySchema.parse({ page_size: "50" }), { page: 1, page_size: 50 });
  assert.deepEqual(MisPedidosQuerySchema.parse({ page: "3", page_size: "25" }), { page: 3, page_size: 25 });
  assert.deepEqual(MisPedidosQuerySchema.parse({ page: 4, page_size: 1 }), { page: 4, page_size: 1 });
});

test("MisPedidosQuerySchema rechaza page fuera del contrato", () => {
  for (const page of [0, "0", -1, "-1", 1.5, "1.5", "abc", "NaN", NaN, "Infinity", Infinity, "", " ", "+1", "01", "1e2", Number.MAX_SAFE_INTEGER + 1, "999999999999999999999999999999999999"]) {
    assert.equal(MisPedidosQuerySchema.safeParse({ page }).success, false, `page inválido aceptado: ${String(page)}`);
  }
});

test("MisPedidosQuerySchema rechaza page_size fuera del contrato", () => {
  for (const page_size of [0, "0", -1, "-1", 51, "51", 10.5, "10.5", "abc", "NaN", NaN, "Infinity", Infinity, "", " ", "+20", "020", "2e1", Number.MAX_SAFE_INTEGER, "999999999999999999999999999999999999"]) {
    assert.equal(MisPedidosQuerySchema.safeParse({ page_size }).success, false, `page_size inválido aceptado: ${String(page_size)}`);
  }
});

test("MisPedidosQuerySchema rechaza parámetros de identidad y otras claves ajenas", () => {
  for (const key of ["clienteId", "cuentaId", "email", "DNI", "dni", "usuarioId"]) {
    const result = MisPedidosQuerySchema.safeParse({ [key]: "valor" });
    assert.equal(result.success, false, `parámetro de identidad aceptado: ${key}`);
  }
  assert.equal(MisPedidosQuerySchema.safeParse({ page: "1", desconocido: "valor" }).success, false);
});

test("PedidoWebIdSchema acepta un UUID válido", () => {
  assert.equal(PedidoWebIdSchema.parse(UUID_VALIDO), UUID_VALIDO);
});

test("PedidoWebIdSchema rechaza UUID inválido, vacío, espacios, números y paths manipulados", () => {
  for (const id of [
    "",
    " ",
    "no-uuid",
    "11111111-1111-1111-1111-11111111111",
    "11111111-1111-1111-1111-111111111111/otro",
    "../11111111-1111-4111-8111-111111111111",
    "11111111-1111-4111-8111-111111111111%2Fotro",
    " 11111111-1111-4111-8111-111111111111 ",
  ]) {
    assert.equal(PedidoWebIdSchema.safeParse(id).success, false, `pedidoId inválido aceptado: ${id}`);
  }
  assert.equal(PedidoWebIdSchema.safeParse(123).success, false);
});
