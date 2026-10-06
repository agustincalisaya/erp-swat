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
const ahora = new Date("2026-10-01T12:00:00.000Z");
const vigente = new Date("2026-10-02T12:00:00.000Z");
const vencido = new Date("2026-09-30T12:00:00.000Z");

type Estado = "PAGO_PENDIENTE" | "PAGO_CONFIRMADO" | "PAGO_RECHAZADO" | "EN_PREPARACION" | "LISTO_PARA_RETIRO" | "ENTREGADO" | "ANULADO" | "CANCELADO" | "VENCIDO_SIN_RETIRO";

function pedido(
  id: string,
  owner: string,
  canal: "WEB" | "MOSTRADOR",
  estado: Estado,
  opciones: {
    fecha?: Date;
    plazo?: Date | null;
    token?: string | null;
    pedidoActivo?: boolean;
    pedidoEliminado?: boolean;
    ecommerceActivo?: boolean;
    ecommerceEliminado?: boolean;
  } = {},
) {
  const pedidoActivo = opciones.pedidoActivo ?? true;
  const ecommerceActivo = opciones.ecommerceActivo ?? true;
  return {
    id,
    numero_venta: `V-${id}`,
    cliente_id: owner,
    canal,
    is_active: pedidoActivo,
    deleted_at: opciones.pedidoEliminado ? ahora : null,
    created_at: opciones.fecha ?? ahora,
    total: new Prisma.Decimal(150),
    mercadopago_payment_id: "mp-no-publico",
    ecommerce: canal === "WEB" ? {
      estado_ecommerce: estado,
      plazo_retiro_vencimiento: opciones.plazo ?? null,
      codigo_qr_retiro: opciones.token ?? null,
      is_active: ecommerceActivo,
      deleted_at: opciones.ecommerceEliminado ? ahora : null,
      operador_asignado_id: "operador-no-publico",
      prioridad_manual: 100,
    } : null,
    _count: { items: 1 },
    items: [{
      id: `item-${id}`,
      cantidad: 1,
      precio_unitario: new Prisma.Decimal(150),
      variante_sku: { sku: "SKU-1", talle: "M", color: "Negro", producto_maestro: { nombre: "Camisa" } },
    }],
    comprobantes: [{
      id: `comprobante-${id}`,
      tipo_comprobante: "FACTURA_B" as const,
      cae_simulado: "12345678901234",
      es_simulado: true,
      qr_data_url: "data:image/png;base64,FISCAL",
      monto_total: new Prisma.Decimal(150),
      created_at: ahora,
      is_active: true,
      deleted_at: null,
    }],
  };
}

type PedidoFixture = ReturnType<typeof pedido>;
type Call = { operation: string; args: Record<string, unknown> };

function fakeDb(rows: PedidoFixture[]) {
  const calls: Call[] = [];
  function matches(row: PedidoFixture, where: Record<string, unknown>) {
    const ecommerceWhere = (where.ecommerce as { is?: { is_active?: boolean; deleted_at?: null } } | undefined)?.is;
    const comprobanteWhere = (where.comprobantes as { some?: { id?: string; is_active?: boolean; deleted_at?: null } } | undefined)?.some;
    return (!where.id || row.id === where.id) &&
      row.cliente_id === where.cliente_id && row.canal === where.canal &&
      (where.is_active === undefined || row.is_active === where.is_active) &&
      (where.deleted_at === undefined || row.deleted_at === where.deleted_at) &&
      row.ecommerce !== null &&
      (!ecommerceWhere || (row.ecommerce.is_active === ecommerceWhere.is_active && row.ecommerce.deleted_at === ecommerceWhere.deleted_at)) &&
      (!comprobanteWhere || row.comprobantes.some((c) => c.id === comprobanteWhere.id));
  }
  const db = { pedidoVenta: {
    findMany: async (args: { where: Record<string, unknown>; orderBy: { created_at?: string; id?: string }[]; skip: number; take: number }) => {
      calls.push({ operation: "findMany", args: args as unknown as Record<string, unknown> });
      return rows.filter((row) => matches(row, args.where))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id))
        .slice(args.skip, args.skip + args.take);
    },
    count: async (args: { where: Record<string, unknown> }) => {
      calls.push({ operation: "count", args: args as unknown as Record<string, unknown> });
      return rows.filter((row) => matches(row, args.where)).length;
    },
    findFirst: async (args: { where: Record<string, unknown> }) => {
      calls.push({ operation: "findFirst", args: args as unknown as Record<string, unknown> });
      return rows.find((row) => matches(row, args.where)) ?? null;
    },
  } } as unknown as PrismaClient;
  return { db, calls };
}

const notFound = (error: unknown) => error instanceof ServiceError && error.code === "PEDIDO_NO_ENCONTRADO";
const comprobanteNotFound = (error: unknown) => error instanceof ServiceError && error.code === "COMPROBANTE_NO_ENCONTRADO";

test("listado filtra propietario, WEB y soft delete, ordena y pagina con proyección mínima", async () => {
  const { db, calls } = fakeDb([
    pedido("a", clienteId, "WEB", "ENTREGADO", { fecha: new Date("2026-09-01T00:00:00Z") }),
    pedido("b", clienteId, "WEB", "CANCELADO", { fecha: new Date("2026-10-01T00:00:00Z") }),
    pedido("c", clienteId, "WEB", "PAGO_RECHAZADO", { fecha: new Date("2026-10-01T00:00:00Z") }),
    pedido("mostrador", clienteId, "MOSTRADOR", "ENTREGADO"),
    pedido("ajeno", otroClienteId, "WEB", "ENTREGADO"),
    pedido("pedido-inactivo", clienteId, "WEB", "CANCELADO", { pedidoActivo: false }),
    pedido("pedido-eliminado", clienteId, "WEB", "CANCELADO", { pedidoEliminado: true }),
    pedido("ecommerce-inactivo", clienteId, "WEB", "CANCELADO", { ecommerceActivo: false }),
    pedido("ecommerce-eliminado", clienteId, "WEB", "CANCELADO", { ecommerceEliminado: true }),
  ]);
  const result = await listarPedidosWebCliente(clienteId, { db, pagina: 1, porPagina: 2 });
  assert.equal(result.total, 3);
  assert.deepEqual(result.pedidos.map((p) => p.id), ["c", "b"]);
  assert.deepEqual((await listarPedidosWebCliente(clienteId, { db, pagina: 2, porPagina: 2 })).pedidos.map((p) => p.id), ["a"]);
  assert.deepEqual(Object.keys(result.pedidos[0]).sort(), ["cantidad_items", "estado", "fecha", "id", "numero", "total"]);

  const findMany = calls.find((call) => call.operation === "findMany")?.args;
  assert.deepEqual(findMany?.orderBy, [{ created_at: "desc" }, { id: "desc" }]);
  assert.deepEqual(findMany?.where, {
    cliente_id: clienteId,
    canal: "WEB",
    is_active: true,
    deleted_at: null,
    ecommerce: { is: { is_active: true, deleted_at: null } },
  });
  const serializedSelect = JSON.stringify(findMany?.select);
  for (const field of ["codigo_qr_retiro", "plazo_retiro_vencimiento", "operador_asignado_id", "prioridad_manual", "mercadopago"]) {
    assert.ok(!serializedSelect.includes(field), `El listado no debe seleccionar ${field}`);
  }
});

test("servicio conserva validación de paginación y overflow", async () => {
  const { db } = fakeDb([]);
  for (const opciones of [
    { pagina: 0, porPagina: 20 },
    { pagina: 1, porPagina: 0 },
    { pagina: 1, porPagina: 51 },
    { pagina: Number.MAX_SAFE_INTEGER, porPagina: 50 },
  ]) {
    await assert.rejects(
      () => listarPedidosWebCliente(clienteId, { db, ...opciones }),
      (error: unknown) => error instanceof ServiceError && error.code === "PAGINACION_INVALIDA",
    );
  }
});

test("detalle propio activo aplica IDOR uniforme y minimiza DTO", async () => {
  const propio = pedido("propio", clienteId, "WEB", "ENTREGADO");
  const { db, calls } = fakeDb([
    propio,
    pedido("ajeno", otroClienteId, "WEB", "ENTREGADO"),
    pedido("mostrador", clienteId, "MOSTRADOR", "ENTREGADO"),
    pedido("pedido-inactivo", clienteId, "WEB", "ENTREGADO", { pedidoActivo: false }),
    pedido("pedido-eliminado", clienteId, "WEB", "ENTREGADO", { pedidoEliminado: true }),
    pedido("ecommerce-inactivo", clienteId, "WEB", "ENTREGADO", { ecommerceActivo: false }),
    pedido("ecommerce-eliminado", clienteId, "WEB", "ENTREGADO", { ecommerceEliminado: true }),
  ]);
  const detail = await obtenerPedidoWebCliente(clienteId, "propio", { db, ahora });
  assert.deepEqual(detail.items[0], {
    producto: "Camisa", sku: "SKU-1", talle: "M", color: "Negro", cantidad: 1, precio_unitario: 150,
  });
  assert.deepEqual(detail.comprobante, { tipo: "FACTURA_B", fecha_emision: ahora.toISOString(), monto: 150 });
  for (const id of ["ajeno", "inexistente", "mostrador", "pedido-inactivo", "pedido-eliminado", "ecommerce-inactivo", "ecommerce-eliminado"]) {
    await assert.rejects(() => obtenerPedidoWebCliente(clienteId, id, { db, ahora }), notFound);
  }
  const json = JSON.stringify(detail);
  for (const field of [
    "codigo_qr_retiro", "mp-no-publico", "mercadopago", "operador-no-publico", "operador_asignado_id",
    "prioridad_manual", "escaneos", "cae", "es_simulado", "data:image/png;base64,FISCAL", "audit", "item-propio", "comprobante-propio",
  ]) {
    assert.ok(!json.toLowerCase().includes(field.toLowerCase()), `El detalle no debe exponer ${field}`);
  }
  const detailCall = calls.find((call) => call.operation === "findFirst")?.args;
  assert.deepEqual(detailCall?.where, {
    id: "propio",
    cliente_id: clienteId,
    canal: "WEB",
    is_active: true,
    deleted_at: null,
    ecommerce: { is: { is_active: true, deleted_at: null } },
  });
  const detailSelect = JSON.stringify(detailCall?.select);
  assert.ok(detailSelect.includes("codigo_qr_retiro"));
  for (const field of ["mercadopago", "operador_asignado_id", "prioridad_manual", "cae_simulado", "es_simulado", "qr_data_url"]) {
    assert.ok(!detailSelect.includes(field), `El detalle no debe seleccionar ${field}`);
  }
});

test("QR se expone solo en LISTO con token y plazo vigente o nulo", async (t) => {
  await t.test("listo vigente", async () => {
    const token = "opaque-token-vigente";
    const detail = await obtenerPedidoWebCliente(clienteId, "listo", {
      db: fakeDb([pedido("listo", clienteId, "WEB", "LISTO_PARA_RETIRO", { plazo: vigente, token })]).db,
      ahora,
    });
    assert.equal(detail.qr_data_url, await QRCode.toDataURL(token, { errorCorrectionLevel: "M" }));
    assert.ok(!Object.hasOwn(detail, "qr_inconsistente"));
    assert.ok(!JSON.stringify(detail).includes(token));
  });
  await t.test("listo sin plazo", async () => {
    const detail = await obtenerPedidoWebCliente(clienteId, "sin-plazo", {
      db: fakeDb([pedido("sin-plazo", clienteId, "WEB", "LISTO_PARA_RETIRO", { token: "token-sin-plazo" })]).db,
      ahora,
    });
    assert.match(detail.qr_data_url ?? "", /^data:image\/png;base64,/);
  });
  await t.test("listo vencido y listo sin token", async () => {
    const expired = await obtenerPedidoWebCliente(clienteId, "vencido", {
      db: fakeDb([pedido("vencido", clienteId, "WEB", "LISTO_PARA_RETIRO", { plazo: vencido, token: "token-vencido" })]).db,
      ahora,
    });
    assert.equal(expired.qr_data_url, null);
    const missing = await obtenerPedidoWebCliente(clienteId, "sin-token", {
      db: fakeDb([pedido("sin-token", clienteId, "WEB", "LISTO_PARA_RETIRO", { plazo: vigente })]).db,
      ahora,
    });
    assert.equal(missing.qr_data_url, null);
    assert.ok(!Object.hasOwn(missing, "qr_inconsistente"));
  });
  for (const estado of ["PAGO_PENDIENTE", "PAGO_CONFIRMADO", "PAGO_RECHAZADO", "EN_PREPARACION", "ENTREGADO", "ANULADO", "CANCELADO", "VENCIDO_SIN_RETIRO"] as Estado[]) {
    await t.test(estado, async () => {
      const detail = await obtenerPedidoWebCliente(clienteId, estado, {
        db: fakeDb([pedido(estado, clienteId, "WEB", estado, { plazo: vigente, token: `token-${estado}` })]).db,
        ahora,
      });
      assert.equal(detail.qr_data_url, null);
      assert.ok(!Object.hasOwn(detail, "qr_inconsistente"));
    });
  }
});

test("comprobante propio devuelve solo tipo, fecha y monto; ajeno e inexistente son indistinguibles", async () => {
  const { db, calls } = fakeDb([
    pedido("propio", clienteId, "WEB", "ENTREGADO"),
    pedido("ajeno", otroClienteId, "WEB", "ENTREGADO"),
  ]);
  const comprobante = await obtenerComprobanteWebCliente(clienteId, "propio", "comprobante-propio", { db });
  assert.deepEqual(comprobante, { tipo: "FACTURA_B", fecha_emision: ahora.toISOString(), monto: 150 });
  for (const id of ["ajeno", "inexistente"]) {
    await assert.rejects(() => obtenerComprobanteWebCliente(clienteId, id, `comprobante-${id}`, { db }), comprobanteNotFound);
  }
  await assert.rejects(() => obtenerComprobanteWebCliente(clienteId, "propio", "comprobante-ajeno", { db }), comprobanteNotFound);
  const select = JSON.stringify(calls.find((call) => call.operation === "findFirst")?.args.select);
  for (const field of ["cae_simulado", "es_simulado", "qr_data_url"]) assert.ok(!select.includes(field));
});
