import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PedidoEntregadoPayload, RetiroRechazadoPayload } from "../../events/event-types.ts";

/** PostgreSQL descartable con esquema y referencias sembradas; opt-in T6. */
const DATABASE_URL = process.env.HU_E3_T6_INTEGRATION_DATABASE_URL;
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

test("HU-E3 T6: eventos post-commit y AuditLog real", {
  skip: !DATABASE_URL, timeout: 90_000,
}, async (t) => {
  if (!DATABASE_URL) return;
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, { listenersRegistrados, domainEventBus }, {
    validarYEntregarRetiro, RetiroRechazadoError,
  }, { ServiceError }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("../../events/domain-event-bus.ts"),
    import("./retiro-e3.service.ts"),
    import("../../errors/service-error.ts"),
  ]);
  await listenersRegistrados;
  t.after(async () => prisma.$disconnect());

  const sufijo = randomUUID();
  const actor = await prisma.usuario.create({
    data: {
      nombre_usuario: `op.e3t6.${sufijo}`,
      email: `op.e3t6.${sufijo}@test.local`,
      password_hash: "x", password_salt: "x",
      nombre_completo: "Operador E3 T6", estado: "ACTIVO",
    },
    select: { id: true },
  });
  const fixtures: Array<{ clienteId: string; pedidoId: string }> = [];
  t.after(async () => {
    const ahora = new Date();
    for (const f of fixtures) {
      await prisma.pedidoVentaItem.updateMany({
        where: { pedido_venta_id: f.pedidoId }, data: { is_active: false, deleted_at: ahora },
      });
      await prisma.pedidoVentaEcommerce.updateMany({
        where: { pedido_venta_id: f.pedidoId }, data: { is_active: false, deleted_at: ahora },
      });
      await prisma.pedidoVenta.update({
        where: { id: f.pedidoId }, data: { is_active: false, deleted_at: ahora },
      });
      await prisma.cliente.update({
        where: { id: f.clienteId }, data: { is_active: false, deleted_at: ahora },
      });
    }
    await prisma.usuario.update({
      where: { id: actor.id }, data: { is_active: false, deleted_at: ahora },
    });
  });

  const entregados: PedidoEntregadoPayload[] = [];
  const rechazados: RetiroRechazadoPayload[] = [];
  let visibleAlEmitir: Promise<{ estadoB: string; estadoE: string }> | undefined;
  const alEntregar = (payload: PedidoEntregadoPayload) => {
    entregados.push(payload);
    visibleAlEmitir = Promise.all([
      prisma.pedidoVenta.findUniqueOrThrow({
        where: { id: payload.pedido_venta_id }, select: { estado: true },
      }),
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { id: payload.pedido_venta_ecommerce_id }, select: { estado_ecommerce: true },
      }),
    ]).then(([b, e]) => ({ estadoB: b.estado, estadoE: e.estado_ecommerce }));
  };
  const alRechazar = (payload: RetiroRechazadoPayload) => { rechazados.push(payload); };
  domainEventBus.on("ecommerce:pedido_entregado", alEntregar);
  domainEventBus.on("ecommerce:retiro_rechazado", alRechazar);
  t.after(() => {
    domainEventBus.off("ecommerce:pedido_entregado", alEntregar);
    domainEventBus.off("ecommerce:retiro_rechazado", alRechazar);
  });

  async function crearFixture() {
    const id = randomUUID();
    const dni = String(Math.floor(10_000_000 + Math.random() * 90_000_000));
    const qr_token = randomUUID();
    const cliente = await prisma.cliente.create({
      data: { dni, nombre: `Cliente E3 T6 ${id}` }, select: { id: true },
    });
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `V-TEST-E3-T6-${id}`,
        cliente_id: cliente.id, registrado_por_id: actor.id,
        canal: "WEB", estado: "FACTURADO", total: 100,
        items: { create: {
          variante_sku_id: VARIANTE_BORCEGOS_2_ID, cantidad: 2,
          cantidad_facturada: 2, cantidad_entregada: 0, precio_unitario: 50,
        } },
      },
      select: { id: true },
    });
    fixtures.push({ clienteId: cliente.id, pedidoId: pedido.id });
    const extension = await prisma.pedidoVentaEcommerce.create({
      data: { pedido_venta_id: pedido.id, estado_ecommerce: "LISTO_PARA_RETIRO",
        codigo_qr_retiro: qr_token, plazo_retiro_vencimiento: null },
      select: { id: true },
    });
    return { pedido, extension, input: { qr_token, dni } };
  }

  async function esperarAuditoria(accion: string, cantidad: number) {
    for (let intento = 0; intento < 40; intento++) {
      const filas = await prisma.auditLog.findMany({
        where: { usuario_id: actor.id, accion }, orderBy: { created_at: "asc" },
        select: { registro_id: true, tabla_afectada: true, usuario_id: true,
          valor_anterior: true, valor_nuevo: true },
      });
      if (filas.length >= cantidad) return filas;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(`No se materializó AuditLog ${accion}`);
  }

  await t.test("éxito: un evento después del commit y asiento agregado sin secretos", async () => {
    const f = await crearFixture();
    const resultado = await validarYEntregarRetiro(f.input, actor.id);
    assert.equal(resultado.estado, "ENTREGADO");
    assert.equal(entregados.length, 1);
    assert.deepEqual(await visibleAlEmitir, { estadoB: "CERRADO", estadoE: "ENTREGADO" });
    assert.deepEqual({
      pedido_venta_id: entregados[0].pedido_venta_id,
      pedido_venta_ecommerce_id: entregados[0].pedido_venta_ecommerce_id,
      actor_id: entregados[0].actor_id,
      estado_anterior: entregados[0].estado_anterior,
      estado_nuevo: entregados[0].estado_nuevo,
    }, {
      pedido_venta_id: f.pedido.id, pedido_venta_ecommerce_id: f.extension.id,
      actor_id: actor.id, estado_anterior: "LISTO_PARA_RETIRO", estado_nuevo: "ENTREGADO",
    });
    const filas = await esperarAuditoria("PEDIDO_ENTREGADO", 1);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].registro_id, f.extension.id);
    assert.equal(filas[0].tabla_afectada, "pedidos_venta_ecommerce");
    assert.deepEqual(filas[0].valor_anterior, {
      estado_ecommerce: "LISTO_PARA_RETIRO", estado_pedido_venta: "FACTURADO",
    });
    assert.deepEqual({
      estado_ecommerce: (filas[0].valor_nuevo as Record<string, unknown>).estado_ecommerce,
      estado_pedido_venta: (filas[0].valor_nuevo as Record<string, unknown>).estado_pedido_venta,
      qr_consumido: (filas[0].valor_nuevo as Record<string, unknown>).qr_consumido,
      entrega_total: (filas[0].valor_nuevo as Record<string, unknown>).entrega_total,
    }, {
      estado_ecommerce: "ENTREGADO", estado_pedido_venta: "CERRADO",
      qr_consumido: true, entrega_total: true,
    });
    assert.ok(!JSON.stringify({ eventos: entregados, filas }).includes(f.input.qr_token));
    assert.ok(!JSON.stringify({ eventos: entregados, filas }).includes(f.input.dni));
  });

  await t.test("token consumido o inexistente: rechazo sin IDs y AuditLog null", async () => {
    const token = randomUUID();
    await assert.rejects(() => validarYEntregarRetiro({ qr_token: token, dni: "12345678" }, actor.id),
      (error: unknown) => error instanceof RetiroRechazadoError && error.motivo === "TOKEN_NO_RESUELTO");
    assert.equal(rechazados.length, 1);
    assert.equal(rechazados[0].motivo, "TOKEN_NO_RESUELTO");
    assert.equal(rechazados[0].pedido_venta_id, undefined);
    assert.equal(rechazados[0].pedido_venta_ecommerce_id, undefined);
    const filas = await esperarAuditoria("RETIRO_RECHAZADO", 1);
    assert.equal(filas[0].registro_id, null);
    assert.equal(filas[0].tabla_afectada, "pedidos_venta_ecommerce");
    assert.ok(!JSON.stringify({ eventos: rechazados, filas }).includes(token));
  });

  await t.test("DNI distinto: rechazo resuelto con ambos IDs y asiento en extensión", async () => {
    const f = await crearFixture();
    await assert.rejects(() => validarYEntregarRetiro({ ...f.input, dni: "87654321" }, actor.id),
      (error: unknown) => error instanceof RetiroRechazadoError && error.motivo === "DNI_NO_COINCIDE");
    assert.equal(rechazados.length, 2);
    assert.equal(rechazados[1].pedido_venta_id, f.pedido.id);
    assert.equal(rechazados[1].pedido_venta_ecommerce_id, f.extension.id);
    const filas = await esperarAuditoria("RETIRO_RECHAZADO", 2);
    assert.equal(filas[1].registro_id, f.extension.id);
    assert.equal((filas[1].valor_nuevo as Record<string, unknown>).motivo, "DNI_NO_COINCIDE");
    assert.ok(!JSON.stringify({ eventos: rechazados, filas }).includes(f.input.qr_token));
    assert.ok(!JSON.stringify({ eventos: rechazados, filas }).includes(f.input.dni));
  });

  await t.test("fallo E después de B: rollback sin evento ni AuditLog de entrega", async () => {
    const f = await crearFixture();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION hu_e3_t6_omitir_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$
    `);
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER hu_e3_t6_omitir_update
        BEFORE UPDATE ON pedidos_venta_ecommerce
        FOR EACH ROW WHEN (OLD.id = '${f.extension.id}')
        EXECUTE FUNCTION hu_e3_t6_omitir_update()
      `);
      await assert.rejects(() => validarYEntregarRetiro(f.input, actor.id),
        (error: unknown) => error instanceof RetiroRechazadoError &&
          error.motivo === "ESTADO_NO_LISTO");
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS hu_e3_t6_omitir_update ON pedidos_venta_ecommerce");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS hu_e3_t6_omitir_update()");
    }
    assert.equal(entregados.length, 1);
    assert.equal(rechazados.length, 3);
    assert.equal(rechazados[2].pedido_venta_ecommerce_id, f.extension.id);
    const [pedido, extension, items] = await Promise.all([
      prisma.pedidoVenta.findUniqueOrThrow({ where: { id: f.pedido.id }, select: { estado: true } }),
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { id: f.extension.id }, select: { estado_ecommerce: true, codigo_qr_retiro: true },
      }),
      prisma.pedidoVentaItem.findMany({
        where: { pedido_venta_id: f.pedido.id }, select: { cantidad_entregada: true },
      }),
    ]);
    assert.equal(pedido.estado, "FACTURADO");
    assert.equal(extension.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.equal(extension.codigo_qr_retiro, f.input.qr_token);
    assert.deepEqual(items.map((item) => item.cantidad_entregada), [0]);
    assert.equal((await esperarAuditoria("PEDIDO_ENTREGADO", 1)).length, 1);
    const rechazos = await esperarAuditoria("RETIRO_RECHAZADO", 3);
    assert.equal(rechazos[2].registro_id, f.extension.id);
  });

  await t.test("inconsistencia interna no emite rechazo ni entrega", async () => {
    const f = await crearFixture();
    await prisma.pedidoVentaItem.updateMany({
      where: { pedido_venta_id: f.pedido.id }, data: { cantidad_facturada: 1 },
    });
    await assert.rejects(() => validarYEntregarRetiro(f.input, actor.id),
      (error: unknown) => error instanceof ServiceError && error.code === "ESTADO_INCONSISTENTE");
    assert.equal(entregados.length, 1);
    assert.equal(rechazados.length, 3);
    assert.equal((await prisma.pedidoVenta.findUniqueOrThrow({
      where: { id: f.pedido.id }, select: { estado: true },
    })).estado, "FACTURADO");
  });
});
