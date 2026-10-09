import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fuente = readFileSync(new URL("./reintegro-pedido-web.service.ts", import.meta.url), "utf8");
const paso0 = fuente.slice(
  fuente.indexOf("export async function iniciarReintegroPedidoWebPaso0"),
  fuente.indexOf("export async function continuarPasosLocalesReintegroPedidoWeb"),
);
const continuacion = fuente.slice(fuente.indexOf("export async function continuarPasosLocalesReintegroPedidoWeb"));

test("T07 mantiene el orden global PedidoVenta → extensión → items", () => {
  const pedido = paso0.indexOf("FROM pedidos_venta");
  const extension = paso0.indexOf("FROM pedidos_venta_ecommerce");
  const items = paso0.indexOf("FROM pedido_venta_items pvi");
  assert.ok(pedido >= 0 && pedido < extension && extension < items);
  assert.match(paso0, /ORDER BY pvi\.created_at ASC, pvi\.id ASC\s+FOR UPDATE OF pvi, r/);
});

test("Paso 0 crea cabecera e hijas dentro de la transición local", () => {
  assert.match(paso0, /prisma\.\$transaction/);
  assert.match(paso0, /pedidoVentaEcommerce\.updateMany/);
  assert.match(paso0, /reintegroPedidoWeb\.create/);
  assert.match(paso0, /compensaciones_stock:\s*\{\s*create:/);
  assert.match(paso0, /`HU-E13:STOCK:\$\{pedido\.id\}:\$\{item\.id\}`/);
});

test("evidencia normal y fallback legacy mantienen contradicciones como error", () => {
  assert.match(paso0, /transaccionPagoLog\.findMany/);
  assert.match(paso0, /evidenciaContradictoria/);
  assert.match(paso0, /ventaMedioPago\.findMany/);
  assert.match(paso0, /medio\.medio !== "MERCADO_PAGO"/);
  assert.match(paso0, /medio\.referencia !== extension\.mercadopago_payment_id/);
  assert.doesNotMatch(paso0, /transaccionPagoLog\.(create|update|upsert)/);
  assert.doesNotMatch(paso0, /ingresoTesoreria/);
});

test("cliente web se valida por cuenta y cliente; deleted_by usa Canal Web", () => {
  assert.match(paso0, /cuentaClienteWeb\.findFirst/);
  assert.match(paso0, /id: input\.cliente_web_cuenta_id/);
  assert.match(paso0, /cliente_id: pedido\.cliente_id/);
  assert.match(paso0, /deletedBy = await obtenerUsuarioCanalWebId\(tx\)/);
  assert.doesNotMatch(paso0, /deletedBy = cuenta\.id/);
});

test("continuación delega estrictamente T03 → T04 → T05", () => {
  const nc = continuacion.indexOf("emitirNotaCreditoReintegroPedidoWeb(");
  const stock = continuacion.indexOf("compensarVentaPagada(");
  const g11 = continuacion.indexOf("registrarContraAsiento(");
  assert.ok(nc >= 0 && nc < stock && stock < g11);
});

test("T07 no llama F1 ni crea intents; T09 publica solo el hecho terminal post-commit", () => {
  assert.doesNotMatch(fuente, /solicitarReembolso|mercadopago\/adapter/);
  assert.doesNotMatch(fuente, /reintegroRefundIntento\.(create|update|upsert)/);
  assert.doesNotMatch(fuente, /auditLog\.(create|update)|notificacion\.(create|update)/);
  const commit = fuente.indexOf("const resultado: InicioReintegroPedidoWebResultado = await prisma.$transaction");
  const emitir = fuente.indexOf("domainEventBus.emit(eventoTerminal.valor.nombre");
  assert.ok(commit >= 0 && emitir > commit);
});

test("T07 conserva B FACTURADO y no borra físicamente", () => {
  assert.doesNotMatch(fuente, /pedidoVenta\.(update|updateMany|delete|deleteMany)/);
  assert.doesNotMatch(fuente, /\.delete\(|\.deleteMany\(/);
  assert.doesNotMatch(fuente, /estado:\s*"ANULADO"/);
});
