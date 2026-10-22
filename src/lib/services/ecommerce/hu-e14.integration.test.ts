/**
 * HU-E14 — proyecciones de la cola de preparación (spec E §6.3) contra
 * PostgreSQL aislado. Fixtures propios, sin DELETE: las bajas se hacen por
 * `is_active`/`deleted_at` (RULES §1).
 *
 * El PrismaClient espía (log de queries por evento) se instala en
 * `globalThis.prisma` ANTES del import dinámico de `db/prisma.ts` y del
 * servicio, para que el singleton que usa `listarColaPreparacion` sea el que
 * captura el SQL (E14-2/E14-4: la proyección base no consulta datos de pago).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient, type EstadoEcommerce, type MedioPagoVenta, type Prisma } from "@prisma/client";

const DATABASE_URL = process.env.HU_E14_INTEGRATION_DATABASE_URL;

const CLAVES_BASE = [
  "cliente_nombre",
  "estado_ecommerce",
  "fecha_pago_confirmado",
  "lineas",
  "numero_venta",
  "operador_asignado_id",
  "pedido_venta_ecommerce_id",
  "pedido_venta_id",
  "prioridad_manual",
  "progreso",
  "unidades_totales",
];

test("HU-E14 — proyección base y con pago de la cola de preparación", {
  skip: !DATABASE_URL,
  timeout: 180_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  assert.match(new URL(DATABASE_URL!).pathname, /test/i, "la base de integración debe ser de test");

  const espia = new PrismaClient({
    datasourceUrl: DATABASE_URL,
    log: [{ emit: "event", level: "query" }],
  });
  const sqlCapturado: string[] = [];
  espia.$on("query", (e: Prisma.QueryEvent) => {
    sqlCapturado.push(e.query);
  });
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = espia;

  const [{ prisma }, pickPack] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./pick-pack.service.ts"),
  ]);
  // Los pedidos propios salen de la cola al terminar (baja lógica de la
  // extensión, sin DELETE) para no alterar el orden que asumen otras suites.
  const pedidosCreados: string[] = [];
  t.after(async () => {
    await prisma.pedidoVentaEcommerce.updateMany({
      where: { pedido_venta_id: { in: pedidosCreados } },
      data: { is_active: false, deleted_at: new Date(), deletion_reason: "fixture HU-E14" },
    });
    // Deja terminar la auditoría post-commit de `completarPreparacion` (D7).
    await new Promise((resolve) => setTimeout(resolve, 500));
    await prisma.$disconnect();
  });
  assert.equal(prisma, espia, "db/prisma.ts debe reutilizar el cliente espía");

  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const proveedor = await prisma.proveedor.create({
    data: { razon_social: "Proveedor E14", cuit: `30-E14-${sufijo}`, estado: "HOMOLOGADO" },
    select: { id: true },
  });
  const producto = await prisma.productoMaestro.create({
    data: {
      codigo_producto: `PPE14-${sufijo}`,
      nombre: "Producto E14",
      rubro: "Test",
      categoria: "Test",
      unidad_medida: "UNIDAD",
      costo_estandar_referencia: 1000,
    },
    select: { id: true },
  });
  const variante = await prisma.varianteSKU.create({
    data: {
      producto_maestro_id: producto.id,
      sku: `PPE14-L-AZUL-H-${sufijo}`,
      talle: "L",
      color: "AZUL",
      genero: "HOMBRE",
      modelo: "TEST",
      proveedor_id: proveedor.id,
    },
    select: { id: true, sku: true },
  });
  const usuario = (nombre: string) => prisma.usuario.create({
    data: {
      nombre_usuario: `${nombre}.e14.${sufijo}`,
      email: `${nombre}.e14.${sufijo}@test.local`,
      password_hash: "x",
      password_salt: "x",
      nombre_completo: `${nombre} E14`,
      estado: "ACTIVO",
    },
    select: { id: true },
  });
  const adminId = (await usuario("admin")).id;
  const operadorId = (await usuario("operador")).id;

  let dniSecuencia = 0;
  const crearCliente = (nombre: string, extra: Prisma.ClienteUncheckedCreateInput | object = {}) =>
    prisma.cliente.create({
      data: {
        dni: `8${String(Date.now()).slice(-6)}${dniSecuencia++}`,
        nombre,
        email: `cliente.${dniSecuencia}.${sufijo}@test.local`,
        telefono: `387400${String(dniSecuencia).padStart(4, "0")}`,
        ...extra,
      },
      select: { id: true, nombre: true, dni: true, email: true, telefono: true },
    });

  const clienteActivo = await crearCliente("Cliente Activo E14");

  async function crearPedido(o: {
    cliente_id?: string | null;
    total?: number;
    estado_ecommerce?: EstadoEcommerce;
    prioridad?: number | null;
    fecha_pago?: Date | null;
    items?: Array<{ cantidad: number; baja?: boolean }>;
    medios?: Array<{ medio: MedioPagoVenta; referencia?: string; baja?: boolean }>;
  } = {}) {
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `V-E14-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        cliente_id: o.cliente_id === undefined ? clienteActivo.id : o.cliente_id,
        canal: "WEB",
        estado: "FACTURADO",
        total: o.total ?? 1000,
        registrado_por_id: adminId,
      },
      select: { id: true, numero_venta: true },
    });
    pedidosCreados.push(pedido.id);
    await prisma.pedidoVentaEcommerce.create({
      data: {
        pedido_venta_id: pedido.id,
        estado_ecommerce: o.estado_ecommerce ?? "EN_PREPARACION",
        fecha_pago_confirmado: o.fecha_pago === null ? null : (o.fecha_pago ?? new Date("2026-10-01T12:00:00Z")),
        prioridad_manual: o.prioridad ?? null,
      },
    });
    for (const it of o.items ?? [{ cantidad: 1 }]) {
      await prisma.pedidoVentaItem.create({
        data: {
          pedido_venta_id: pedido.id,
          variante_sku_id: variante.id,
          cantidad: it.cantidad,
          precio_unitario: 1000,
          cantidad_facturada: it.cantidad,
          ...(it.baja ? { is_active: false, deleted_at: new Date(), deletion_reason: "test E14" } : {}),
        },
      });
    }
    for (const m of o.medios ?? [{ medio: "MERCADO_PAGO" as const, referencia: `REF-E14-${randomUUID()}` }]) {
      await prisma.ventaMedioPago.create({
        data: {
          pedido_venta_id: pedido.id,
          medio: m.medio,
          importe: o.total ?? 1000,
          referencia: m.referencia ?? null,
          ...(m.baja ? { is_active: false, deleted_at: new Date(), deletion_reason: "test E14" } : {}),
        },
      });
    }
    return pedido;
  }

  async function colaCompleta(incluirDatosPago: boolean) {
    return incluirDatosPago
      ? pickPack.listarColaPreparacion({ page: 1, page_size: 5000 }, { incluirDatosPago: true })
      : pickPack.listarColaPreparacion({ page: 1, page_size: 5000 });
  }
  function pagoDe(item: object) {
    assert.ok("pago" in item, "la proyección con pago debe traer la clave `pago`");
    return item.pago as { total: string; medios: MedioPagoVenta[] };
  }
  async function itemDe(pedidoId: string, incluirDatosPago: boolean) {
    const cola = await colaCompleta(incluirDatosPago);
    const item = cola.items.find((i) => i.pedido_venta_id === pedidoId);
    assert.ok(item, `el pedido ${pedidoId} debe estar en la cola`);
    return item;
  }

  await t.test("E14-2 — proyección base: sin clave `pago` ni datos de pago/PII", async () => {
    const referencia = `REF-E14-BASE-${randomUUID()}`;
    const pedido = await crearPedido({
      total: 12345.5,
      items: [{ cantidad: 3 }],
      medios: [{ medio: "MERCADO_PAGO", referencia }],
    });
    const item = await itemDe(pedido.id, false);

    assert.equal(Object.hasOwn(item, "pago"), false);
    assert.deepEqual(Object.keys(item).sort(), CLAVES_BASE);
    assert.equal(item.numero_venta, pedido.numero_venta);
    assert.equal(item.cliente_nombre, "Cliente Activo E14");
    assert.equal(item.unidades_totales, 3);

    const json = JSON.stringify(item);
    for (const prohibido of ["12345.5", "MERCADO_PAGO", referencia, clienteActivo.dni, clienteActivo.email!, clienteActivo.telefono!]) {
      assert.equal(json.includes(prohibido), false, `la proyección base no debe contener ${prohibido}`);
    }
  });

  await t.test("E14-2/E14-4 — la proyección base no consulta pago ni datos fiscales", async () => {
    await crearPedido();

    sqlCapturado.length = 0;
    await pickPack.listarColaPreparacion({ page: 1, page_size: 50 });
    const base = [...sqlCapturado];
    assert.ok(base.some((q) => q.includes("pedidos_venta_ecommerce")), "el espía debe haber capturado la consulta de la cola");
    for (const q of base) {
      assert.equal(/venta_medios_pago/.test(q), false, `query base lee medios de pago: ${q}`);
      assert.equal(/log_transacciones_pago/.test(q), false, `query base lee TransaccionPagoLog: ${q}`);
      assert.equal(/comprobantes_fiscales/.test(q), false, `query base lee comprobantes: ${q}`);
      assert.equal(/"pedidos_venta"\."total"/.test(q), false, `query base lee PedidoVenta.total: ${q}`);
    }

    sqlCapturado.length = 0;
    await pickPack.listarColaPreparacion({ page: 1, page_size: 50 }, { incluirDatosPago: true });
    const conPago = [...sqlCapturado];
    assert.ok(conPago.some((q) => /"pedidos_venta"\."total"/.test(q)), "con pago debe leer PedidoVenta.total");
    assert.ok(conPago.some((q) => /venta_medios_pago/.test(q)), "con pago debe leer VentaMedioPago");
    for (const q of conPago) {
      assert.equal(/"referencia"/.test(q), false, `nunca se lee VentaMedioPago.referencia: ${q}`);
      assert.equal(/log_transacciones_pago/.test(q), false, `nunca se lee TransaccionPagoLog: ${q}`);
      assert.equal(/comprobantes_fiscales/.test(q), false, `nunca se leen comprobantes: ${q}`);
    }
  });

  await t.test("E14-3 — proyección con pago: total congelado y medios activos", async () => {
    const referencia = `REF-E14-PAGO-${randomUUID()}`;
    const pedido = await crearPedido({
      total: 12345.5,
      medios: [
        { medio: "MERCADO_PAGO", referencia },
        { medio: "MERCADO_PAGO", referencia: `${referencia}-dup` },
        { medio: "TARJETA", baja: true },
      ],
    });
    const item = await itemDe(pedido.id, true);
    const pago = pagoDe(item);
    const totalBd = (await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pedido.id }, select: { total: true } })).total;
    assert.deepEqual(pago, { total: totalBd.toFixed(2), medios: ["MERCADO_PAGO"] });
    assert.equal(pago.total, "12345.50");
    assert.equal(JSON.stringify(item).includes(referencia), false);

    const sinMedio = await crearPedido({ medios: [] });
    assert.deepEqual(pagoDe(await itemDe(sinMedio.id, true)).medios, []);

    const varios = await crearPedido({ medios: [{ medio: "MERCADO_PAGO" }, { medio: "TARJETA" }] });
    assert.deepEqual(pagoDe(await itemDe(varios.id, true)).medios, ["MERCADO_PAGO", "TARJETA"]);
  });

  await t.test("§6.3 — cliente no resoluble → cliente_nombre null, sin otra identidad", async () => {
    const sinCliente = await crearPedido({ cliente_id: null });
    const inactivo = await crearCliente("Cliente Inactivo E14", { is_active: false });
    const borrado = await crearCliente("Cliente Borrado E14", { deleted_at: new Date() });
    const primario = await crearCliente("Cliente Primario E14");
    const fusionado = await crearCliente("Cliente Fusionado E14", {
      is_active: false,
      deleted_at: new Date(),
      deletion_reason: "duplicado",
      fusionado_en_id: primario.id,
    });

    for (const [pedido, nombreOculto] of [
      [sinCliente, null],
      [await crearPedido({ cliente_id: inactivo.id }), inactivo.nombre],
      [await crearPedido({ cliente_id: borrado.id }), borrado.nombre],
      [await crearPedido({ cliente_id: fusionado.id }), fusionado.nombre],
    ] as const) {
      for (const incluirDatosPago of [false, true]) {
        const item = await itemDe(pedido.id, incluirDatosPago);
        assert.equal(item.cliente_nombre, null);
        const json = JSON.stringify(item);
        if (nombreOculto) assert.equal(json.includes(nombreOculto), false);
        assert.equal(json.includes(primario.nombre), false, "no se sigue fusionado_en_id");
      }
    }
  });

  await t.test("E14-1 — unidades_totales suma solo ítems vigentes", async () => {
    const pedido = await crearPedido({ items: [{ cantidad: 2 }, { cantidad: 3 }, { cantidad: 5, baja: true }] });
    for (const incluirDatosPago of [false, true]) {
      const item = await itemDe(pedido.id, incluirDatosPago);
      assert.equal(item.unidades_totales, 5);
      assert.equal(item.progreso.total_requerido, 5);
      assert.equal(item.lineas.length, 2);
    }
  });

  await t.test("orden contractual y paginación idénticos en ambas proyecciones", async () => {
    const p = 1_000_000 + (Date.now() % 1_000_000);
    const a = await crearPedido({ prioridad: p + 1 });
    const b = await crearPedido({ prioridad: p, fecha_pago: new Date("2026-10-01T09:00:00Z") });
    const c = await crearPedido({ prioridad: p, fecha_pago: new Date("2026-10-01T10:00:00Z") });
    const d = await crearPedido({ prioridad: null, fecha_pago: new Date("2020-01-01T00:00:00Z") });
    const propios = [a.id, b.id, c.id, d.id];

    async function recorrer(incluirDatosPago: boolean) {
      const ids: string[] = [];
      let total = -1;
      for (let page = 1; ; page++) {
        const r = incluirDatosPago
          ? await pickPack.listarColaPreparacion({ page, page_size: 2 }, { incluirDatosPago: true })
          : await pickPack.listarColaPreparacion({ page, page_size: 2 });
        total = r.total;
        assert.ok(r.items.length <= 2);
        ids.push(...r.items.map((i) => i.pedido_venta_id));
        if (r.items.length < 2) break;
      }
      return { ids, total };
    }
    const base = await recorrer(false);
    const conPago = await recorrer(true);
    assert.equal(base.total, conPago.total);
    assert.equal(base.ids.length, base.total);
    assert.deepEqual(base.ids, conPago.ids);
    assert.deepEqual(base.ids.filter((id) => propios.includes(id)), propios);
  });

  await t.test("D7 — tomar/prioridad/scan/completar no exponen datos de pago", async () => {
    const referencia = `REF-E14-D7-${randomUUID()}`;
    const prohibidos = ["pago", "\"total\"", "medio", "MERCADO_PAGO", referencia, "777.77"];
    const sinPago = (r: unknown) => {
      const json = JSON.stringify(r);
      for (const x of prohibidos) assert.equal(json.includes(x), false, `${x} en ${json}`);
    };

    const libre = await crearPedido({ total: 777.77, medios: [{ medio: "MERCADO_PAGO", referencia }] });
    const prioridad = await pickPack.actualizarPrioridad(libre.id, adminId, 3);
    assert.deepEqual(Object.keys(prioridad).sort(), ["cambio_realizado", "pedido_venta_id", "prioridad_anterior", "prioridad_manual"]);
    sinPago(prioridad);

    const pedido = await crearPedido({
      total: 777.77,
      estado_ecommerce: "PAGO_CONFIRMADO",
      medios: [{ medio: "MERCADO_PAGO", referencia }],
    });
    const tomado = await pickPack.tomarPedido(pedido.id, operadorId);
    assert.deepEqual(Object.keys(tomado).sort(), ["cambio_realizado", "operador_asignado_id", "pedido_venta_id"]);
    sinPago(tomado);

    const scan = await pickPack.confirmarItem(pedido.id, operadorId, { scan_id: randomUUID(), codigo: variante.sku });
    // `pve_id` y `cantidad_confirmada_anterior` son internos y hoy llegan al
    // JSON de scan (preexistente, fuera de E14: DT-5). No son datos de pago.
    assert.deepEqual(Object.keys(scan).sort(), [
      "cambio_realizado", "cantidad_confirmada", "cantidad_confirmada_anterior", "idempotente",
      "pedido_venta_item_id", "progreso", "pve_id", "scan_id", "variante_sku_id",
    ]);
    sinPago(scan);

    const completo = await pickPack.completarPreparacion(pedido.id, operadorId);
    // Ídem DT-5: `pve_id` y `vencimiento_iso` son internos y llegan al JSON.
    assert.deepEqual(Object.keys(completo).sort(), [
      "cambio_realizado", "estado_ecommerce", "idempotente", "pedido_venta_id", "plazo_retiro_vencimiento",
      "progreso", "pve_id", "transicion_realizada", "vencimiento_iso",
    ]);
    sinPago(completo);
  });
});
