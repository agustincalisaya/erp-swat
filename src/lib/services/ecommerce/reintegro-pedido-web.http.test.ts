import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cliente = readFileSync(new URL("../../../app/api/tienda/mis-pedidos/[id]/cancelar/route.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../../../app/api/ecommerce/pedidos/[id]/cancelar/route.ts", import.meta.url), "utf8");
const reintento = readFileSync(new URL("../../../app/api/ecommerce/pedidos/[id]/reintegro/reintentar/route.ts", import.meta.url), "utf8");

test("cancelación cliente usa sesión web, cuenta canónica y solo CANCELACION_CLIENTE", () => {
  assert.match(cliente, /withSesionClienteWeb<Context>/);
  assert.match(cliente, /cliente_web_cuenta_id: sesion\.cuentaId/);
  assert.match(cliente, /causa: "CANCELACION_CLIENTE"/);
  assert.doesNotMatch(cliente, /body\.data\.(?:cliente|usuario|actor)/);
  assert.doesNotMatch(cliente, /domainEventBus|auditLog|notificacion/);
  assert.match(cliente, /reintegro\.estado === "PENDIENTE" && reintegro\._count\.intentos_refund === 0/);
  assert.match(cliente, /continuarRefundPedidoWeb\(inicio\.reintegro_id\)/);
  assert.match(cliente, /reintegro_iniciado: true/);
  assert.doesNotMatch(cliente, /nota_credito_id:|reintegro_id: inicio|estado_reintegro:|intento_id:/);
});

test("cancelación administrativa y reintento exigen el permiso exacto y actor de sesión", () => {
  for (const route of [admin, reintento]) {
    assert.match(route, /withPermission\(PERMISO_CANCELAR_PEDIDO_PAGADO/);
    assert.doesNotMatch(route, /ADMINISTRADOR_ECOMMERCE/);
    assert.doesNotMatch(route, /body\.data\.(?:usuario|actor|solicitado_por)/);
  }
  assert.match(admin, /usuario_id: session\.userId/);
  assert.match(admin, /causa: "CANCELACION_ADMIN"/);
  assert.match(admin, /reintegro\.estado === "PENDIENTE" && reintegro\._count\.intentos_refund === 0/);
  assert.match(admin, /continuarRefundPedidoWeb\(inicio\.reintegro_id\)/);
  assert.match(reintento, /usuario_id: session\.userId/);
});

test("rutas HU-E13 no duplican efectos ni exponen secretos de pago", () => {
  for (const route of [cliente, admin, reintento]) {
    assert.doesNotMatch(route, /\.update\(|\.updateMany\(|\.create\(/);
    assert.doesNotMatch(route, /clave_idempotencia|mercadopago_payment_id|refund_id|access_token|Authorization/);
    assert.doesNotMatch(route, /domainEventBus|registrarAuditLog|notificacion\./);
  }
  assert.match(reintento, /solicitarReintentoManualRefund/);
  assert.match(reintento, /intento_reutilizado/);
});
