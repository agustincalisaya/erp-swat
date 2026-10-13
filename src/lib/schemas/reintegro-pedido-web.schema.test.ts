import assert from "node:assert/strict";
import test from "node:test";
import {
  CancelarPedidoPagadoSchema,
  PedidoVentaReintegroIdSchema,
  ReintentarRefundSchema,
} from "./reintegro-pedido-web.schema.ts";

test("HU-E13 HTTP: motivo es obligatorio, se recorta y no admite impersonación", () => {
  assert.deepEqual(CancelarPedidoPagadoSchema.parse({ motivo: "  Cambio de decisión  " }), {
    motivo: "Cambio de decisión",
  });
  for (const body of [{}, { motivo: "" }, { motivo: "   " }, { motivo: 1 }]) {
    assert.equal(CancelarPedidoPagadoSchema.safeParse(body).success, false);
    assert.equal(ReintentarRefundSchema.safeParse(body).success, false);
  }
  for (const actor of ["usuario_id", "actor_id", "cliente_id", "cliente_web_cuenta_id", "solicitado_por_id"]) {
    assert.equal(CancelarPedidoPagadoSchema.safeParse({ motivo: "Válido", [actor]: crypto.randomUUID() }).success, false);
    assert.equal(ReintentarRefundSchema.safeParse({ motivo: "Válido", [actor]: crypto.randomUUID() }).success, false);
  }
});

test("HU-E13 HTTP: el path exige pedido UUID", () => {
  assert.equal(PedidoVentaReintegroIdSchema.safeParse(crypto.randomUUID()).success, true);
  assert.equal(PedidoVentaReintegroIdSchema.safeParse("pedido-ajeno").success, false);
});
