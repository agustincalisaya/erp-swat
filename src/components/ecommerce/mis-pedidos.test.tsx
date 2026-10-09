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
  historial_estados: [],
  qr_data_url: null, comprobante: null, nota_credito: null, motivo: null, fecha_terminacion: null, reintegro_estado: null };

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

test("cancelar pedido solo aparece en PAGO_CONFIRMADO y los terminales siguen visibles", () => {
  for (const estado of ["PAGO_CONFIRMADO", "EN_PREPARACION", "LISTO_PARA_RETIRO", "CANCELADO", "VENCIDO_SIN_RETIRO"] as const) {
    const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...detalle, estado } }));
    assert.equal(html.includes("Cancelar pedido"), estado === "PAGO_CONFIRMADO");
    assert.ok(html.includes(estado === "CANCELADO" ? "Cancelado" : estado === "VENCIDO_SIN_RETIRO" ? "Vencido sin retiro" : "Pedido V-2026-100"));
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

test("detalle muestra cronología con etiquetas de negocio y mensaje para historial vacío", () => {
  const vacio = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: detalle }));
  assert.ok(vacio.includes("Historial del pedido"));
  assert.ok(vacio.includes("No hay historial de estados disponible."));
  const conHistorial = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: {
    ...detalle, historial_estados: [
      { estado: "PAGO_PENDIENTE", fecha: "2026-10-08T18:40:00.000Z" },
      { estado: "PAGO_CONFIRMADO", fecha: "2026-10-08T18:42:00.000Z" },
    ],
  } }));
  assert.ok(conHistorial.includes("Pago pendiente"));
  assert.ok(conHistorial.includes("Pago confirmado"));
  assert.ok(conHistorial.includes('dateTime="2026-10-08T18:40:00.000Z"') || conHistorial.includes('dateTime="2026-10-08T18:40:00.000Z"'.toLowerCase()) || conHistorial.includes('datetime="2026-10-08T18:40:00.000Z"'));
  assert.ok(!conHistorial.includes("PAGO_CONFIRMADO"));
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

test("comprobante original ofrece descarga propia y sin comprobante no muestra la acción", () => {
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...detalle,
    comprobante: { tipo: "FACTURA_B", fecha_emision: detalle.fecha, monto: 150 },
  } }));
  assert.ok(html.includes("FACTURA B"));
  assert.ok(html.includes("Monto"));
  assert.ok(html.includes("Descargar comprobante"));
  assert.ok(html.includes("/api/tienda/mis-pedidos/own-id/comprobante/descargar"));
  assert.ok(!html.includes("/api/ventas/comprobantes/"));
  assert.ok(!renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: detalle })).includes("Descargar comprobante"));
  assert.doesNotMatch(html, /simulado|fixture|seed|mock|\/api\/ventas\/comprobantes/i);
});

const terminal = {
  ...detalle,
  estado: "CANCELADO" as const,
  motivo: "Me equivoqué de talle",
  fecha_terminacion: "2026-10-03T15:30:00.000Z",
  comprobante: { tipo: "FACTURA_B" as const, fecha_emision: "2026-10-01T12:00:00.000Z", monto: 150 },
  nota_credito: { tipo: "NOTA_CREDITO" as const, fecha_emision: "2026-10-03T15:31:00.000Z", monto: 150 },
};

test("terminal HU-E13 muestra motivo, fecha de terminación y estado agregado del reintegro", () => {
  for (const [reintegro, texto] of [
    ["PENDIENTE", "Reintegro en proceso"],
    ["APROBADO", "Reintegro completado"],
    ["RECHAZADO", "Reintegro rechazado"],
  ] as const) {
    const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...terminal, reintegro_estado: reintegro } }));
    assert.ok(html.includes("Pedido cancelado"));
    assert.ok(html.includes("Me equivoqué de talle"));
    assert.ok(html.includes("03/10/2026 12:30"), "fecha de terminación en hora Argentina");
    assert.ok(html.includes(texto));
    for (const otro of ["Reintegro en proceso", "Reintegro completado", "Reintegro rechazado"].filter((t) => t !== texto)) {
      assert.ok(!html.includes(otro));
    }
    assert.ok(!html.includes("Reintentar"));
  }
  const vencido = renderToStaticMarkup(createElement(DetallePedidoWeb, {
    pedido: { ...terminal, estado: "VENCIDO_SIN_RETIRO", motivo: "Plazo de retiro vencido", reintegro_estado: "APROBADO" },
  }));
  assert.ok(vencido.includes("Pedido vencido"));
  assert.ok(vencido.includes("Plazo de retiro vencido"));
});

test("sin saga no inventa estado de reintegro y un pedido activo no muestra bloque terminal", () => {
  const legacy = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...terminal, reintegro_estado: null } }));
  assert.ok(legacy.includes("Me equivoqué de talle"));
  assert.doesNotMatch(legacy, /Reintegro/);
  const activo = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...detalle, estado: "EN_PREPARACION" } }));
  assert.doesNotMatch(activo, /Pedido cancelado|Pedido vencido|Reintegro|Motivo/);
});

test("factura original sigue visible y la NC aparece por separado solo si existe", () => {
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...terminal, reintegro_estado: "APROBADO" } }));
  assert.ok(html.includes("FACTURA B"));
  assert.ok(html.includes("Nota de crédito"));
  assert.ok(html.includes("NOTA CREDITO"));
  assert.ok(html.indexOf("FACTURA B") < html.indexOf("NOTA CREDITO"));
  assert.equal(html.match(/Descargar comprobante/g)?.length, 1);
  const sinNc = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...terminal, nota_credito: null } }));
  assert.ok(sinNc.includes("FACTURA B"));
  assert.ok(!sinNc.includes("Nota de crédito"));
  assert.ok(!sinNc.includes("NOTA CREDITO"));
});

test("DOM del detalle terminal no expone identificadores ni datos técnicos del reintegro", () => {
  const conExtras = {
    ...terminal,
    reintegro_estado: "RECHAZADO" as const,
    reintegro_id: "reintegro-secreto",
    intento_id: "intento-secreto",
    refund_id: "refund-secreto",
    mercadopago_payment_id: "payment-secreto",
    clave_idempotencia: "HU-E13:REFUND:secreto",
    ultimo_error_codigo: "HTTP_400",
  } as PedidoWebDetalle;
  const html = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: conExtras }));
  assert.doesNotMatch(html, /reintegro_id|intento_id|refund_id|payment|idempotency|clave_idempotencia|ultimo_error_codigo|secreto|HU-E13:REFUND|HTTP_400/i);
});

test("fechas de listado y detalle son deterministas e independientes de la TZ del proceso (hydration)", () => {
  const original = process.env.TZ;
  const renders = new Set<string>();
  try {
    for (const tz of ["UTC", "Asia/Tokyo", "America/Argentina/Salta"]) {
      process.env.TZ = tz;
      const listado = renderToStaticMarkup(createElement(MisPedidosListado, { pedidos: [resumen] }));
      const detalleHtml = renderToStaticMarkup(createElement(DetallePedidoWeb, { pedido: { ...terminal, reintegro_estado: "APROBADO" } }));
      assert.ok(listado.includes("Fecha del pedido: 01/10/2026"), tz);
      assert.ok(detalleHtml.includes("Fecha del pedido: 01/10/2026 09:00"), tz);
      assert.ok(detalleHtml.includes("03/10/2026 12:31"), `emisión de la NC en ${tz}`);
      renders.add(listado + detalleHtml);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
  assert.equal(renders.size, 1, "el HTML no cambia con la zona horaria del runtime");
});
