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
    motivo?: string | null;
    comprobantes?: ComprobanteFixture[];
    reintegro?: { estado: "PENDIENTE" | "APROBADO" | "RECHAZADO"; nota_credito: ComprobanteFixture | null } | null;
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
      deletion_reason: opciones.motivo ?? null,
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
    comprobantes: opciones.comprobantes ?? [comprobante(`comprobante-${id}`, id)],
    reintegro_web: opciones.reintegro ?? null,
  };
}

type ComprobanteFixture = ReturnType<typeof comprobante>;

function comprobante(
  id: string,
  pedidoId: string,
  tipo: "FACTURA_B" | "NOTA_CREDITO" = "FACTURA_B",
  originalId: string | null = null,
  fecha: Date = ahora,
) {
  return {
    id,
    pedido_venta_id: pedidoId,
    comprobante_original_id: originalId,
    tipo_comprobante: tipo,
    cae_simulado: "12345678901234",
    es_simulado: true,
    qr_data_url: "data:image/png;base64,FISCAL",
    monto_total: new Prisma.Decimal(150),
    created_at: fecha,
    is_active: true,
    deleted_at: null,
  };
}

type PedidoFixture = ReturnType<typeof pedido>;
type Call = { operation: string; args: Record<string, unknown> };

function fakeDb(rows: PedidoFixture[]) {
  const calls: Call[] = [];
  function matches(row: PedidoFixture, where: Record<string, unknown>) {
    const ecommerceWhere = (where.ecommerce as { is?: {
      is_active?: boolean;
      deleted_at?: null;
      OR?: { is_active: boolean; deleted_at: null | { not: null }; estado_ecommerce?: { in: Estado[] } }[];
    } } | undefined)?.is;
    const comprobanteWhere = (where.comprobantes as { some?: { id?: string; is_active?: boolean; deleted_at?: null } } | undefined)?.some;
    return (!where.id || row.id === where.id) &&
      row.cliente_id === where.cliente_id && row.canal === where.canal &&
      (where.is_active === undefined || row.is_active === where.is_active) &&
      (where.deleted_at === undefined || row.deleted_at === where.deleted_at) &&
      row.ecommerce !== null &&
      (!ecommerceWhere || (ecommerceWhere.OR
        ? ecommerceWhere.OR.some((filtro) =>
            row.ecommerce!.is_active === filtro.is_active &&
            (filtro.deleted_at === null ? row.ecommerce!.deleted_at === null : row.ecommerce!.deleted_at !== null) &&
            (!filtro.estado_ecommerce || filtro.estado_ecommerce.in.includes(row.ecommerce!.estado_ecommerce)))
        : row.ecommerce.is_active === ecommerceWhere.is_active && row.ecommerce.deleted_at === ecommerceWhere.deleted_at)) &&
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
    pedido("historico-cancelado", clienteId, "WEB", "CANCELADO", {
      fecha: new Date("2026-10-03T00:00:00Z"), ecommerceActivo: false, ecommerceEliminado: true,
    }),
    pedido("historico-vencido", clienteId, "WEB", "VENCIDO_SIN_RETIRO", {
      fecha: new Date("2026-10-02T00:00:00Z"), ecommerceActivo: false, ecommerceEliminado: true,
    }),
    pedido("legacy-anulado", clienteId, "WEB", "ANULADO", { ecommerceActivo: false, ecommerceEliminado: true }),
    pedido("inactivo-entregado", clienteId, "WEB", "ENTREGADO", { ecommerceActivo: false, ecommerceEliminado: true }),
    pedido("mostrador", clienteId, "MOSTRADOR", "ENTREGADO"),
    pedido("ajeno", otroClienteId, "WEB", "ENTREGADO"),
    pedido("pedido-inactivo", clienteId, "WEB", "CANCELADO", { pedidoActivo: false }),
    pedido("pedido-eliminado", clienteId, "WEB", "CANCELADO", { pedidoEliminado: true }),
    pedido("ecommerce-inactivo", clienteId, "WEB", "CANCELADO", { ecommerceActivo: false }),
    pedido("ecommerce-eliminado", clienteId, "WEB", "CANCELADO", { ecommerceEliminado: true }),
  ]);
  const result = await listarPedidosWebCliente(clienteId, { db, pagina: 1, porPagina: 2 });
  assert.equal(result.total, 5);
  assert.deepEqual(result.pedidos.map((p) => p.id), ["historico-cancelado", "historico-vencido"]);
  assert.deepEqual((await listarPedidosWebCliente(clienteId, { db, pagina: 2, porPagina: 2 })).pedidos.map((p) => p.id), ["c", "b"]);
  assert.deepEqual((await listarPedidosWebCliente(clienteId, { db, pagina: 3, porPagina: 2 })).pedidos.map((p) => p.id), ["a"]);
  assert.deepEqual(Object.keys(result.pedidos[0]).sort(), ["cantidad_items", "estado", "fecha", "id", "numero", "total"]);

  const findMany = calls.find((call) => call.operation === "findMany")?.args;
  assert.deepEqual(findMany?.orderBy, [{ created_at: "desc" }, { id: "desc" }]);
  assert.deepEqual(findMany?.where, {
    cliente_id: clienteId,
    canal: "WEB",
    is_active: true,
    deleted_at: null,
    ecommerce: { is: {
      OR: [
        { is_active: true, deleted_at: null },
        {
          is_active: false,
          deleted_at: { not: null },
          estado_ecommerce: { in: ["CANCELADO", "VENCIDO_SIN_RETIRO"] },
        },
      ],
    } },
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
    pedido("cancelado-historico", clienteId, "WEB", "CANCELADO", {
      ecommerceActivo: false, ecommerceEliminado: true, token: "token-no-publico",
    }),
    pedido("vencido-historico", clienteId, "WEB", "VENCIDO_SIN_RETIRO", {
      ecommerceActivo: false, ecommerceEliminado: true, token: "token-no-publico",
    }),
    pedido("cancelado-ajeno", otroClienteId, "WEB", "CANCELADO", { ecommerceActivo: false, ecommerceEliminado: true }),
  ]);
  const detail = await obtenerPedidoWebCliente(clienteId, "propio", { db, ahora });
  assert.deepEqual(detail.items[0], {
    producto: "Camisa", sku: "SKU-1", talle: "M", color: "Negro", cantidad: 1, precio_unitario: 150,
  });
  assert.deepEqual(detail.comprobante, { tipo: "FACTURA_B", fecha_emision: ahora.toISOString(), monto: 150 });
  for (const id of ["ajeno", "cancelado-ajeno", "inexistente", "mostrador", "pedido-inactivo", "pedido-eliminado", "ecommerce-inactivo", "ecommerce-eliminado"]) {
    await assert.rejects(() => obtenerPedidoWebCliente(clienteId, id, { db, ahora }), notFound);
  }
  for (const id of ["cancelado-historico", "vencido-historico"]) {
    const historico = await obtenerPedidoWebCliente(clienteId, id, { db, ahora });
    assert.equal(historico.qr_data_url, null);
    assert.equal(historico.reintegro_estado, null);
    assert.equal(historico.nota_credito, null);
    assert.doesNotMatch(JSON.stringify(historico), /token-no-publico|reintegro_id|refund|mercadopago|contra_asiento|ultimo_error/i);
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
    ecommerce: { is: {
      OR: [
        { is_active: true, deleted_at: null },
        {
          is_active: false,
          deleted_at: { not: null },
          estado_ecommerce: { in: ["CANCELADO", "VENCIDO_SIN_RETIRO"] },
        },
      ],
    } },
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

test("post-T17: terminal expone motivo, fecha_terminacion y reintegro_estado; activo y sin saga dan null", async () => {
  const factura = comprobante("factura-cancelado", "cancelado", "FACTURA_B", null, new Date("2026-09-30T10:00:00.000Z"));
  const { db } = fakeDb([
    pedido("cancelado", clienteId, "WEB", "CANCELADO", {
      ecommerceActivo: false, ecommerceEliminado: true, motivo: "Me equivoqué de talle",
      comprobantes: [factura], reintegro: { estado: "RECHAZADO", nota_credito: null },
    }),
    pedido("vencido", clienteId, "WEB", "VENCIDO_SIN_RETIRO", {
      ecommerceActivo: false, ecommerceEliminado: true, motivo: "Plazo de retiro vencido",
      reintegro: { estado: "PENDIENTE", nota_credito: null },
    }),
    pedido("activo", clienteId, "WEB", "EN_PREPARACION", { motivo: "no debe verse" }),
  ]);
  const cancelado = await obtenerPedidoWebCliente(clienteId, "cancelado", { db, ahora });
  assert.equal(cancelado.motivo, "Me equivoqué de talle");
  assert.equal(cancelado.fecha_terminacion, ahora.toISOString());
  assert.equal(cancelado.reintegro_estado, "RECHAZADO");
  const vencidoDetalle = await obtenerPedidoWebCliente(clienteId, "vencido", { db, ahora });
  assert.equal(vencidoDetalle.motivo, "Plazo de retiro vencido");
  assert.equal(vencidoDetalle.reintegro_estado, "PENDIENTE");
  const activo = await obtenerPedidoWebCliente(clienteId, "activo", { db, ahora });
  assert.equal(activo.motivo, null);
  assert.equal(activo.fecha_terminacion, null);
  assert.equal(activo.reintegro_estado, null);
  assert.deepEqual(Object.keys(cancelado).sort(), [
    "comprobante", "estado", "fecha", "fecha_terminacion", "id", "items", "motivo", "nota_credito",
    "numero", "plazo_retiro_vencimiento", "qr_data_url", "reintegro_estado", "total",
  ]);
});

test("post-T17: comprobante es el original y la NC sale solo del vínculo de la saga", async () => {
  const original = comprobante("original", "con-nc", "FACTURA_B", null, new Date("2026-09-30T10:00:00.000Z"));
  const nc = comprobante("nc", "con-nc", "NOTA_CREDITO", "original", new Date("2026-10-01T10:00:00.000Z"));
  const ncAjena = comprobante("nc-ajena", "otro-pedido", "NOTA_CREDITO", "otro-original");
  const { db, calls } = fakeDb([
    pedido("con-nc", clienteId, "WEB", "CANCELADO", {
      ecommerceActivo: false, ecommerceEliminado: true, motivo: "Cancelado",
      comprobantes: [original, nc], reintegro: { estado: "APROBADO", nota_credito: nc },
    }),
    pedido("nc-incoherente", clienteId, "WEB", "CANCELADO", {
      ecommerceActivo: false, ecommerceEliminado: true,
      comprobantes: [comprobante("orig-2", "nc-incoherente")], reintegro: { estado: "APROBADO", nota_credito: ncAjena },
    }),
    pedido("ambiguo", clienteId, "WEB", "ENTREGADO", {
      comprobantes: [comprobante("a1", "ambiguo"), comprobante("a2", "ambiguo")],
    }),
    pedido("sin-comprobante", clienteId, "WEB", "PAGO_PENDIENTE", { comprobantes: [] }),
  ]);
  const detalle = await obtenerPedidoWebCliente(clienteId, "con-nc", { db, ahora });
  assert.deepEqual(detalle.comprobante, { tipo: "FACTURA_B", fecha_emision: "2026-09-30T10:00:00.000Z", monto: 150 });
  assert.deepEqual(detalle.nota_credito, { tipo: "NOTA_CREDITO", fecha_emision: "2026-10-01T10:00:00.000Z", monto: 150 });
  assert.doesNotMatch(JSON.stringify(detalle), /"original"|"nc"|comprobante_original_id|pedido_venta_id/);
  assert.equal((await obtenerPedidoWebCliente(clienteId, "nc-incoherente", { db, ahora })).nota_credito, null);
  const ambiguo = await obtenerPedidoWebCliente(clienteId, "ambiguo", { db, ahora });
  assert.equal(ambiguo.comprobante, null);
  assert.equal(ambiguo.nota_credito, null);
  assert.equal((await obtenerPedidoWebCliente(clienteId, "sin-comprobante", { db, ahora })).comprobante, null);

  const select = calls.find((call) => call.operation === "findFirst")?.args.select as Record<string, unknown>;
  assert.deepEqual((select.comprobantes as Record<string, unknown>).where, { tipo_comprobante: { not: "NOTA_CREDITO" } });
  assert.deepEqual((select.comprobantes as Record<string, unknown>).orderBy, [{ created_at: "asc" }, { id: "asc" }]);
  assert.equal((select.comprobantes as Record<string, unknown>).take, 2);
  for (const campo of ["mercadopago", "refund", "clave_idempotencia", "ultimo_error", "contra_asiento", "intento", "solicitado_por"]) {
    assert.ok(!JSON.stringify(select.reintegro_web).includes(campo), `reintegro_web no debe seleccionar ${campo}`);
  }
});

test("post-T17: comprobante individual acepta la visibilidad histórica E9 y conserva ownership", async () => {
  const { db, calls } = fakeDb([
    pedido("cancelado", clienteId, "WEB", "CANCELADO", { ecommerceActivo: false, ecommerceEliminado: true }),
    pedido("vencido", clienteId, "WEB", "VENCIDO_SIN_RETIRO", { ecommerceActivo: false, ecommerceEliminado: true }),
    pedido("cancelado-ajeno", otroClienteId, "WEB", "CANCELADO", { ecommerceActivo: false, ecommerceEliminado: true }),
    pedido("anulado", clienteId, "WEB", "ANULADO", { ecommerceActivo: false, ecommerceEliminado: true }),
    pedido("entregado-inactivo", clienteId, "WEB", "ENTREGADO", { ecommerceActivo: false, ecommerceEliminado: true }),
  ]);
  for (const id of ["cancelado", "vencido"]) {
    assert.deepEqual(await obtenerComprobanteWebCliente(clienteId, id, `comprobante-${id}`, { db }), {
      tipo: "FACTURA_B", fecha_emision: ahora.toISOString(), monto: 150,
    });
  }
  for (const id of ["cancelado-ajeno", "anulado", "entregado-inactivo"]) {
    await assert.rejects(() => obtenerComprobanteWebCliente(clienteId, id, `comprobante-${id}`, { db }), comprobanteNotFound);
  }
  const where = calls.find((call) => call.operation === "findFirst")?.args.where as Record<string, unknown>;
  assert.deepEqual(where.ecommerce, { is: {
    OR: [
      { is_active: true, deleted_at: null },
      { is_active: false, deleted_at: { not: null }, estado_ecommerce: { in: ["CANCELADO", "VENCIDO_SIN_RETIRO"] } },
    ],
  } });
});
