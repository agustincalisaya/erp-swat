import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fuente = readFileSync(new URL("./reintegro-refund.service.ts", import.meta.url), "utf8");

test("T08 fija backoff exponencial sin jitter y cap 360", () => {
  assert.match(fuente, /Math\.min\(5 \* 2 \*\* \(intentosTecnicos - 1\), 360\)/);
  const esperados = [5, 10, 20, 40, 80, 160, 320, 360, 360];
  assert.deepEqual(esperados.map((_, indice) => Math.min(5 * 2 ** indice, 360)), esperados);
});

test("T08 expone preparación, continuación automática y reintento manual", () => {
  assert.match(fuente, /async function prepararIntentoRefundAutomatico/);
  assert.match(fuente, /async function continuarRefundPedidoWeb/);
  assert.match(fuente, /async function solicitarReintentoManualRefund/);
  assert.match(fuente, /export const prepararIntentoRefundAutomatico/);
  assert.match(fuente, /export const continuarRefundPedidoWeb/);
  assert.match(fuente, /export const solicitarReintentoManualRefund/);
});

test("T08 confirma el intento antes de ejecutar F1", () => {
  const preparar = fuente.indexOf("async function prepararIntentoRefundAutomatico");
  const ejecutar = fuente.indexOf("async function ejecutarPreparado");
  const continuar = fuente.indexOf("async function continuarRefundPedidoWeb");
  assert.ok(preparar >= 0 && preparar < ejecutar && ejecutar < continuar);
  assert.match(fuente.slice(continuar), /await prepararIntentoRefundAutomatico\(reintegroId\)[\s\S]*return ejecutarPreparado\(preparado\)/);
});

test("T08 no implementa HTTP, cron, notificaciones ni AuditLog directo", () => {
  assert.doesNotMatch(fuente, /withPermission|NextRequest|NextResponse/);
  assert.doesNotMatch(fuente, /auditLog\.|notificacion\./);
  assert.doesNotMatch(fuente, /mantenimientoProgramado|CRON_SECRET/);
  assert.match(fuente, /domainEventBus\.emit\("ecommerce:reintegro_estado_cambiado"/);
});

test("T08 no modifica estados B/E ni recrea efectos locales", () => {
  assert.doesNotMatch(fuente, /pedidoVenta\.(update|create|delete)/);
  assert.doesNotMatch(fuente, /pedidoVentaEcommerce\.(update|create|delete)/);
  assert.doesNotMatch(fuente, /comprobanteFiscal\.(create|update|delete)/);
  assert.doesNotMatch(fuente, /movimientoStock\.(create|update|delete)/);
  assert.doesNotMatch(fuente, /contraAsientoIngreso\.(create|update|delete)/);
});
