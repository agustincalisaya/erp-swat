import assert from "node:assert/strict";
import test from "node:test";
import { AnularOrdenNoAbonadaSchema, PedidoVentaIdSchema } from "./ecommerce.schema.ts";

/** HU-E7 (spec E §2.7; task_relos.md §2, D12) — body de la anulación manual. */

const mensajeCampo = (resultado: ReturnType<typeof AnularOrdenNoAbonadaSchema.safeParse>) =>
  resultado.error?.flatten().fieldErrors.deletion_reason?.[0];
const mensajeRaiz = (resultado: ReturnType<typeof AnularOrdenNoAbonadaSchema.safeParse>) =>
  resultado.error?.flatten().formErrors[0];

test("válido: acepta el motivo y lo recorta", () => {
  assert.deepEqual(AnularOrdenNoAbonadaSchema.parse({ deletion_reason: "  El cliente desistió  " }), {
    deletion_reason: "El cliente desistió",
  });
});

test("sin tope de largo en deletion_reason (decisión de Adriel)", () => {
  assert.equal(AnularOrdenNoAbonadaSchema.safeParse({ deletion_reason: "x".repeat(5000) }).success, true);
});

test("vacío, ausente o solo espacios: 'El motivo de anulación es obligatorio'", () => {
  for (const body of [{ deletion_reason: "" }, { deletion_reason: "   " }, {}]) {
    const r = AnularOrdenNoAbonadaSchema.safeParse(body);
    assert.equal(r.success, false, JSON.stringify(body));
    assert.equal(mensajeCampo(r), "El motivo de anulación es obligatorio", JSON.stringify(body));
  }
});

test("no string: error en deletion_reason", () => {
  for (const deletion_reason of [42, null, true, ["motivo"], { texto: "x" }]) {
    const r = AnularOrdenNoAbonadaSchema.safeParse({ deletion_reason });
    assert.equal(r.success, false, JSON.stringify(deletion_reason));
    assert.ok(mensajeCampo(r), JSON.stringify(deletion_reason));
  }
});

test("campo extra (actor, deleted_by, estado…): 'El cuerpo contiene campos no permitidos'", () => {
  for (const extra of ["actor_id", "deleted_by", "estado", "usuario_id", "automatico"]) {
    const r = AnularOrdenNoAbonadaSchema.safeParse({ deletion_reason: "Motivo", [extra]: "x" });
    assert.equal(r.success, false, extra);
    assert.equal(mensajeRaiz(r), "El cuerpo contiene campos no permitidos", extra);
  }
});

test("raíz no objeto (null, array, string, número, ausente): 'El cuerpo debe ser un objeto JSON'", () => {
  for (const body of [null, [], ["x"], "texto", 3, undefined]) {
    const r = AnularOrdenNoAbonadaSchema.safeParse(body);
    assert.equal(r.success, false, JSON.stringify(body));
    assert.equal(mensajeRaiz(r), "El cuerpo debe ser un objeto JSON", JSON.stringify(body));
  }
});

test("PedidoVentaIdSchema: exige UUID", () => {
  assert.equal(PedidoVentaIdSchema.safeParse("f8aad0fc-85a3-4dd4-81cf-4fbf3fc14f6b").success, true);
  assert.equal(PedidoVentaIdSchema.safeParse("no-es-uuid").success, false);
});
