import assert from "node:assert/strict";
import test from "node:test";
import { cancelarPedidoWebApi, mensajeErrorCancelacion } from "./cancelacion-pedido-web.client.ts";

test("cancelación Cliente Web usa PATCH exacto y body mínimo con motivo recortado", async () => {
  const llamadas: { input: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ input: String(input), init });
    return new Response(JSON.stringify({
      data: { pedido_venta_id: "pedido-1", estado_ecommerce: "CANCELADO", reintegro_iniciado: true },
      error: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const resultado = await cancelarPedidoWebApi("pedido-1", "  Decisión cliente  ", fetchImpl as typeof fetch);
  assert.equal(resultado.ok, true);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0]?.input, "/api/tienda/mis-pedidos/pedido-1/cancelar");
  assert.equal(llamadas[0]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(llamadas[0]?.init?.body)), { motivo: "Decisión cliente" });
  assert.deepEqual(Object.keys(JSON.parse(String(llamadas[0]?.init?.body))), ["motivo"]);
});

test("mensajes HTTP son públicos y no exponen detalles de refund", () => {
  assert.equal(mensajeErrorCancelacion(400), "Ingresá un motivo válido para cancelar el pedido.");
  assert.equal(mensajeErrorCancelacion(401), "Tu sesión venció. Volvé a ingresar para continuar.");
  assert.equal(mensajeErrorCancelacion(404), "El pedido ya no está disponible.");
  assert.equal(mensajeErrorCancelacion(409), "El pedido cambió de estado y ya no puede cancelarse.");
  assert.equal(mensajeErrorCancelacion(500), "No pudimos cancelar el pedido. Intentá nuevamente.");
  const serializado = [400, 401, 404, 409, 500].map(mensajeErrorCancelacion).join(" ");
  assert.doesNotMatch(serializado, /mercado pago|refund|reintegro_id|intento_id|payment|idempot/i);
});

test("error de red devuelve contrato seguro", async () => {
  const resultado = await cancelarPedidoWebApi("pedido-1", "Motivo", async () => { throw new Error("access_token secreto"); });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 0);
  assert.equal(resultado.json.error?.message, "No se pudo conectar con el servidor.");
  assert.doesNotMatch(JSON.stringify(resultado), /access_token/);
});
