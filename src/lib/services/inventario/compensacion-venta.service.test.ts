import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fuente = readFileSync(new URL("./compensacion-venta.service.ts", import.meta.url), "utf8");
const helper = fuente.slice(
  fuente.indexOf("export async function compensarVentaPagadaTx"),
  fuente.indexOf("export async function compensarVentaPagada("),
);

test("la compensación bloquea la hija y representa INGRESO VENDIDO a DISPONIBLE", () => {
  assert.match(helper, /FROM reintegro_stock_compensaciones[\s\S]*FOR UPDATE/);
  assert.match(helper, /tipo_movimiento: "INGRESO"/);
  assert.match(helper, /estado_origen: "VENDIDO"/);
  assert.match(helper, /estado_destino: "DISPONIBLE"/);
});

test("stock, movimiento y vínculo se escriben sobre el TransactionClient recibido", () => {
  assert.match(helper, /tx\.stockDeposito\.updateMany/);
  assert.match(helper, /tx\.movimientoStock\.create/);
  assert.match(helper, /tx\.reintegroStockCompensacion\.updateMany/);
  assert.doesNotMatch(helper, /prisma\.\$transaction/);
});

test("la idempotencia reutiliza movimiento_stock_id y no usa liberarReservasTx", () => {
  assert.match(helper, /if \(compensacion\.movimiento_stock_id\)/);
  assert.match(helper, /resultado: "YA_EXISTENTE"/);
  assert.doesNotMatch(fuente, /liberarReservasTx/);
});

test("T04 no escribe pedidos, ecommerce, NC, G11 ni refund", () => {
  assert.doesNotMatch(helper, /pedidoVenta\.(update|delete|create)/);
  assert.doesNotMatch(helper, /pedidoVentaEcommerce\.(update|delete|create)/);
  assert.doesNotMatch(helper, /comprobanteFiscal\.(update|delete|create)/);
  assert.doesNotMatch(helper, /contraAsientoIngreso\.(update|delete|create)/);
  assert.doesNotMatch(helper, /reintegroRefundIntento\.(update|delete|create)/);
});
