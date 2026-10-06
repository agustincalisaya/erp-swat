import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccesoPedidosCuenta } from "../tienda/AccesoPedidosCuenta.tsx";
import { DetallePedidoWeb } from "./DetallePedidoWeb.tsx";
import { MisPedidosListado, PaginacionPedidos } from "./MisPedidosListado.tsx";
import type { PedidoWebDetalle } from "../../lib/services/ecommerce/mis-pedidos.service.ts";

const resumen = { id: "own-id", numero: "V-2026-100", fecha: "2026-10-01T12:00:00.000Z", total: 150,
  estado: "ENTREGADO" as const, cantidad_items: 1 };
const detalle: PedidoWebDetalle = { ...resumen, items: [{ producto: "Camisa", sku: "SKU-1", talle: "M", color: "Negro", cantidad: 2, precio_unitario: 75 }], plazo_retiro_vencimiento: null,
  qr_data_url: null, comprobante: null };

test("listado responsive contiene número, fecha, total, estado, enlace al detalle y estados de UI", () => {
  const html = renderToStaticMarkup(createElement(MisPedidosListado, { pedidos: [resumen] }));
  for (const value of ["V-2026-100", "Entregado", "Fecha del pedido:", "Total", "1 artículo", "/tienda/cuenta/pedidos/own-id", "sm:flex-row"]) assert.ok(html.includes(value));
  for (const [estado, texto] of [
    [undefined, "Todavía no tenés pedidos"],
    ["cargando", "Cargando pedidos"],
    ["sesion_no_disponible", "Iniciá sesión como Cliente Web"],
    ["error", "No pudimos cargar tus pedidos"],
  ] as const) {
    assert.ok(renderToStaticMarkup(createElement(MisPedidosListado, { pedidos: [], estado })).includes(texto));
  }
});

test("Mi cuenta ofrece pedidos solo a cuentas vinculadas", () => {
  const vinculada = renderToStaticMarkup(createElement(AccesoPedidosCuenta, { vinculacionPendiente: false }));
  assert.ok(vinculada.includes("Mis pedidos"));
  assert.ok(vinculada.includes('/tienda/cuenta/pedidos'));
  assert.equal(renderToStaticMarkup(createElement(AccesoPedidosCuenta, { vinculacionPendiente: true })), "");
});

test("paginación genera URLs navegables y se oculta para una sola página", () => {
  const html = renderToStaticMarkup(createElement(PaginacionPedidos, { pagina: 2, totalPaginas: 3, porPagina: 20 }));
  assert.ok(html.includes("Página 2 de 3"));
  assert.ok(html.includes("page=1&amp;page_size=20"));
  assert.ok(html.includes("page=3&amp;page_size=20"));
  assert.equal(renderToStaticMarkup(createElement(PaginacionPedidos, { pagina: 1, totalPaginas: 1, porPagina: 20 })), "");
});

test("detalle no muestra QR sin data URL y ofrece estados indistinguibles de pedido no encontrado", () => {
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: detalle }));
  for (const value of ["V-2026-100", "Fecha del pedido:", "Camisa", "SKU-1", "M", "Negro", "2 u.", "Total", "/tienda/cuenta/pedidos"]) assert.ok(html.includes(value));
  assert.ok(!html.includes("Pedido listo para retirar"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "no_encontrado" })).includes("El pedido solicitado no existe"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "sesion_no_disponible" })).includes("Iniciá sesión como Cliente Web"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "error" })).includes("No pudimos cargar el pedido"));
  assert.ok(renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: null, estado: "cargando" })).includes("Cargando pedido"));
});

test("detalle listo muestra QR solo si servicio entrega imagen y un mensaje funcional cuando no está disponible", () => {
  const listo = { ...detalle, estado: "LISTO_PARA_RETIRO" as const, qr_data_url: "data:image/png;base64,AAAA" };
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: listo }));
  assert.ok(html.includes("Pedido listo para retirar"));
  assert.ok(html.includes("data:image/png;base64,AAAA"));
  const sinQr = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...listo, qr_data_url: null } }));
  assert.ok(sinQr.includes("El código de retiro no está disponible"));
  assert.ok(!sinQr.includes("data:image/png"));
});

test("comprobante se presenta sin jerga técnica ni descarga fiscal inventada", () => {
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...detalle,
    comprobante: { tipo: "FACTURA_B", fecha_emision: detalle.fecha, monto: 150 },
  } }));
  assert.ok(html.includes("FACTURA B"));
  assert.ok(html.includes("Monto"));
  assert.ok(html.includes("Comprobante no disponible para descarga"));
  assert.ok(!html.includes("Descargar comprobante"));
  assert.doesNotMatch(html, /simulado|fixture|seed|mock|\/api\/ventas\/comprobantes/i);
});
