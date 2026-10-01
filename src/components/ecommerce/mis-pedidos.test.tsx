import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DetallePedidoWeb } from "./DetallePedidoWeb.tsx";
import { MisPedidosListado } from "./MisPedidosListado.tsx";
import type { PedidoWebDetalle } from "../../lib/services/ecommerce/mis-pedidos.service.ts";

const resumen = { id: "own-id", numero: "V-2026-100", fecha: "2026-10-01T12:00:00.000Z", total: 150,
  estado: "ENTREGADO" as const, cantidad_items: 1 };
const detalle: PedidoWebDetalle = { ...resumen, items: [], plazo_retiro_vencimiento: null,
  qr_data_url: null, qr_inconsistente: false, comprobante: null };

test("listado responsive contiene número, fecha, total, estado, enlace al detalle y estados de UI", () => {
  const html = renderToStaticMarkup(createElement(MisPedidosListado, { pedidos: [resumen] }));
  for (const value of ["V-2026-100", "Entregado", "Total:", "/cuenta/pedidos/own-id", "sm:flex-row"]) assert.ok(html.includes(value));
  for (const [estado, texto] of [
    [undefined, "Todavía no tenés pedidos web"],
    ["cargando", "Cargando pedidos"],
    ["sesion_no_disponible", "Iniciá sesión como Cliente Web"],
    ["error", "No pudimos cargar tus pedidos"],
  ] as const) {
    assert.ok(renderToStaticMarkup(createElement(MisPedidosListado, { pedidos: [], estado })).includes(texto));
  }
});

test("detalle no muestra QR sin data URL y ofrece estados indistinguibles de pedido no encontrado", () => {
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: detalle }));
  assert.ok(html.includes("V-2026-100"));
  assert.ok(!html.includes("Código QR de retiro"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "no_encontrado" })).includes("El pedido solicitado no existe"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "sesion_no_disponible" })).includes("Iniciá sesión como Cliente Web"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "error" })).includes("No pudimos cargar el pedido"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "cargando" })).includes("Cargando pedido"));
});

test("detalle listo muestra QR solo si servicio entrega imagen; reporta token ausente sin inventarlo", () => {
  const listo = { ...detalle, estado: "LISTO_PARA_RETIRO" as const, qr_data_url: "data:image/png;base64,AAAA" };
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: listo }));
  assert.ok(html.includes("Código QR de retiro"));
  assert.ok(html.includes("data:image/png;base64,AAAA"));
  const sinToken = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...listo, qr_data_url: null, qr_inconsistente: true } }));
  assert.ok(sinToken.includes("El código de retiro no está disponible"));
  assert.ok(!sinToken.includes("data:image/png"));
});

test("comprobante se presenta sin jerga técnica ni descarga fiscal inventada", () => {
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...detalle,
    comprobante: { id: "fiscal", tipo: "FACTURA_B", cae_simulado: "12345678901234", es_simulado: true, fecha: detalle.fecha },
  } }));
  assert.ok(html.includes("FACTURA B"));
  assert.ok(html.includes("Comprobante no disponible para descarga"));
  assert.doesNotMatch(html, /simulado|fixture|seed|mock|\/api\/ventas\/comprobantes/i);
});
