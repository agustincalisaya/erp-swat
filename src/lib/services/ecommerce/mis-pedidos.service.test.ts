import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import QRCode from "qrcode";
import { ServiceError } from "../../errors/service-error.ts";
import {
  listarPedidosWebCliente,
  obtenerPedidoWebCliente,
  obtenerComprobanteWebCliente,
} from "./mis-pedidos.service.ts";

const clienteId = "11111111-1111-4111-8111-111111111111";
const otroClienteId = "22222222-2222-4222-8222-222222222222";
const fecha = new Date("2026-10-01T12:00:00.000Z");
const vigente = new Date("2026-10-02T12:00:00.000Z");
const vencido = new Date("2026-09-30T12:00:00.000Z");

function pedido(id: string, owner: string, canal: "WEB" | "MOSTRADOR", estado: string, plazo: Date | null = null, token: string | null = null, is_active = true) {
  return {
    id, numero_venta: `V-${id}`, cliente_id: owner, canal, is_active,
    created_at: fecha, total: new Prisma.Decimal(150),
    ecommerce: canal === "WEB" ? { estado_ecommerce: estado, plazo_retiro_vencimiento: plazo, codigo_qr_retiro: token } : null,
    _count: { items: 1 },
    items: [{ id: `item-${id}`, cantidad: 1, precio_unitario: new Prisma.Decimal(150),
      variante_sku: { sku: "SKU-1", talle: "M", color: "Negro", producto_maestro: { nombre: "Camisa" } } }],
    comprobantes: [{ id: `comprobante-${id}`, tipo_comprobante: "FACTURA_B", cae_simulado: "12345678901234", es_simulado: true, created_at: fecha }],
  };
}

function fakeDb(rows: ReturnType<typeof pedido>[]) {
  const calls: { operation: string; where: Record<string, unknown> }[] = [];
  function matches(row: ReturnType<typeof pedido>, where: Record<string, unknown>) {
    return row.cliente_id === where.cliente_id && row.canal === where.canal &&
      (!where.id || row.id === where.id) && row.ecommerce !== null &&
      (!where.comprobantes || row.comprobantes.some((c) => c.id === (where.comprobantes as { some: { id: string } }).some.id));
  }
  const db = { pedidoVenta: {
    findMany: async (args: { where: Record<string, unknown>; skip: number; take: number }) => {
      calls.push({ operation: "findMany", where: args.where });
      return rows.filter((row) => matches(row, args.where)).reverse().slice(args.skip, args.skip + args.take);
    },
    count: async (args: { where: Record<string, unknown> }) => {
      calls.push({ operation: "count", where: args.where });
      return rows.filter((row) => matches(row, args.where)).length;
    },
    findFirst: async (args: { where: Record<string, unknown> }) => {
      calls.push({ operation: "findFirst", where: args.where });
      return rows.find((row) => matches(row, args.where)) ?? null;
    },
  } } as unknown as PrismaClient;
  return { db, calls };
}

const notFound = (error: unknown) => error instanceof ServiceError && error.code === "PEDIDO_NO_ENCONTRADO";
const comprobanteNotFound = (error: unknown) => error instanceof ServiceError && error.code === "COMPROBANTE_NO_ENCONTRADO";

test("historial propio: filtra cliente y canal WEB, pagina y conserva entregados/cancelados inactivos", async () => {
  const { db, calls } = fakeDb([
    pedido("entregado", clienteId, "WEB", "ENTREGADO"),
    pedido("mostrador", clienteId, "MOSTRADOR", "ENTREGADO"),
    pedido("ajeno", otroClienteId, "WEB", "EN_PREPARACION"),
    pedido("cancelado", clienteId, "WEB", "CANCELADO", null, null, false),
  ]);
  const result = await listarPedidosWebCliente(clienteId, { db, pagina: 1, porPagina: 1 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.pedidos.map((p) => p.id), ["cancelado"]);
  assert.deepEqual((await listarPedidosWebCliente(clienteId, { db })).pedidos.map((p) => p.id), ["cancelado", "entregado"]);
  assert.ok(calls.every(({ where }) => where.cliente_id === clienteId && where.canal === "WEB" && "ecommerce" in where && !("is_active" in where)));
  assert.deepEqual(Object.keys(result.pedidos[0]).sort(), ["cantidad_items", "estado", "fecha", "id", "numero", "total"]);
});

test("detalle propio y QR únicamente en listo vigente con token opaco", async () => {
  const { db, calls } = fakeDb([pedido("listo", clienteId, "WEB", "LISTO_PARA_RETIRO", vigente, "opaque-token")]);
  const detail = await obtenerPedidoWebCliente(clienteId, "listo", { db, ahora: fecha });
  assert.equal(detail.estado, "LISTO_PARA_RETIRO");
  assert.equal(detail.qr_data_url, await QRCode.toDataURL("opaque-token", { errorCorrectionLevel: "M" }));
  assert.equal(detail.items[0].producto, "Camisa");
  assert.equal(detail.comprobante?.id, "comprobante-listo");
  assert.ok(calls[0].where.id === "listo" && calls[0].where.cliente_id === clienteId && calls[0].where.canal === "WEB");
  const json = JSON.stringify(detail);
  for (const key of ["codigo_qr_retiro", "mercadopago_payment_id", "datos_facturacion_cifrados", "password_hash", "TransaccionPagoLog"]) {
    assert.ok(!json.includes(key), `No debe exponerse ${key}`);
  }
  assert.ok(!json.includes("opaque-token"));
});

test("pedido ajeno e inexistente tienen exactamente el mismo error; canal mostrador tampoco es accesible", async () => {
  const { db } = fakeDb([pedido("ajeno", otroClienteId, "WEB", "ENTREGADO"), pedido("mostrador", clienteId, "MOSTRADOR", "ENTREGADO")]);
  for (const id of ["ajeno", "inexistente", "mostrador"]) {
    await assert.rejects(() => obtenerPedidoWebCliente(clienteId, id, { db }), notFound);
  }
});

test("QR oculto fuera del estado listo, cuando venció o cuando falta el token", async (t) => {
  for (const estado of ["EN_PREPARACION", "PAGO_CONFIRMADO", "ENTREGADO", "VENCIDO_SIN_RETIRO", "CANCELADO", "PAGO_RECHAZADO", "ANULADO", "PAGO_PENDIENTE"]) {
    await t.test(estado, async () => {
      const { db } = fakeDb([pedido(estado, clienteId, "WEB", estado, vigente, "retained-token", estado !== "CANCELADO")]);
      const detail = await obtenerPedidoWebCliente(clienteId, estado, { db, ahora: fecha });
      assert.equal(detail.qr_data_url, null);
      assert.equal(detail.qr_inconsistente, false);
    });
  }
  const expired = await obtenerPedidoWebCliente(clienteId, "expirado", { db: fakeDb([pedido("expirado", clienteId, "WEB", "LISTO_PARA_RETIRO", vencido, "token")]).db, ahora: fecha });
  assert.equal(expired.qr_data_url, null);
  assert.equal(expired.qr_inconsistente, false);
  const missing = await obtenerPedidoWebCliente(clienteId, "sin-token", { db: fakeDb([pedido("sin-token", clienteId, "WEB", "LISTO_PARA_RETIRO", vigente)]).db, ahora: fecha });
  assert.equal(missing.qr_data_url, null);
  assert.equal(missing.qr_inconsistente, true);
  const noDeadline = await obtenerPedidoWebCliente(clienteId, "sin-plazo", { db: fakeDb([pedido("sin-plazo", clienteId, "WEB", "LISTO_PARA_RETIRO", null, "token")]).db, ahora: fecha });
  assert.match(noDeadline.qr_data_url ?? "", /^data:image\/png;base64,/);
});

test("comprobante asociado a pedido propio; el ajeno e inexistente son indistinguibles", async () => {
  const { db, calls } = fakeDb([pedido("propio", clienteId, "WEB", "ENTREGADO"), pedido("ajeno", otroClienteId, "WEB", "ENTREGADO")]);
  const comprobante = await obtenerComprobanteWebCliente(clienteId, "propio", "comprobante-propio", { db });
  assert.equal(comprobante.tipo, "FACTURA_B");
  assert.equal(comprobante.es_simulado, true);
  for (const id of ["ajeno", "inexistente"]) {
    await assert.rejects(() => obtenerComprobanteWebCliente(clienteId, id, `comprobante-${id}`, { db }), comprobanteNotFound);
  }
  await assert.rejects(() => obtenerComprobanteWebCliente(clienteId, "propio", "comprobante-ajeno", { db }), comprobanteNotFound);
  assert.ok(calls.every(({ where }) => where.cliente_id === clienteId && where.canal === "WEB" && "comprobantes" in where));
});
