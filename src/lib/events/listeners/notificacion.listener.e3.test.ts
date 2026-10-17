import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { EcommercePedidoListoParaRetiroPayload, PedidoEntregadoPayload } from "../event-types.ts";

/** Integración opt-in contra PostgreSQL descartable con plantilla F3 sembrada. */
const DATABASE_URL = process.env.HU_E3_T8_INTEGRATION_DATABASE_URL;
const TIPO = "ecommerce:pedido_listo_para_retiro";

test("HU-E3 T8: LISTO crea solo notificación interna idempotente", {
  skip: !DATABASE_URL, timeout: 90_000,
}, async (t) => {
  if (!DATABASE_URL) return;
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, { domainEventBus, listenersRegistrados }, { SUSCRIPCIONES_NOTIFICACION }] = await Promise.all([
    import("../../db/prisma.ts"), import("../domain-event-bus.ts"), import("./notificacion.listener.ts"),
  ]);
  await listenersRegistrados;
  const sufijo = randomUUID();
  const actor = await prisma.usuario.findUniqueOrThrow({
    where: { email: "operador.pickpack.seed@erp-swat.local" }, select: { id: true },
  });
  const cliente = await prisma.cliente.create({
    data: { dni: String(Math.floor(10_000_000 + Math.random() * 90_000_000)), nombre: `Cliente E3 F3 ${sufijo}` },
    select: { id: true },
  });
  const cuenta = await prisma.cuentaClienteWeb.create({
    data: { cliente_id: cliente.id, email: `e3.f3.${sufijo}@test.local`, password_hash: "x" },
    select: { id: true },
  });
  const pedido = await prisma.pedidoVenta.create({
    data: { numero_venta: `V-E3-F3-${sufijo}`, cliente_id: cliente.id,
      registrado_por_id: actor.id, canal: "WEB", estado: "FACTURADO", total: 1 },
    select: { id: true, numero_venta: true },
  });
  const extension = await prisma.pedidoVentaEcommerce.create({
    data: { pedido_venta_id: pedido.id, estado_ecommerce: "LISTO_PARA_RETIRO" },
    select: { id: true },
  });
  t.after(async () => {
    const ahora = new Date();
    await prisma.pedidoVentaEcommerce.update({ where: { id: extension.id }, data: { is_active: false, deleted_at: ahora } });
    await prisma.pedidoVenta.update({ where: { id: pedido.id }, data: { is_active: false, deleted_at: ahora } });
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { is_active: false, deleted_at: ahora } });
    await prisma.cliente.update({ where: { id: cliente.id }, data: { is_active: false, deleted_at: ahora } });
    await prisma.$disconnect();
  });

  const payload: EcommercePedidoListoParaRetiroPayload = {
    evento_id: randomUUID(), pedido_venta_id: pedido.id, pedido_venta_ecommerce_id: extension.id,
    actor_id: actor.id, estado_anterior: "EN_PREPARACION", estado_nuevo: "LISTO_PARA_RETIRO",
    plazo_retiro_vencimiento: new Date(Date.now() + 86_400_000).toISOString(),
    timestamp: new Date().toISOString(), cliente_web_cuenta_id: cuenta.id,
    numero_venta: pedido.numero_venta,
  };
  const suscripcion = SUSCRIPCIONES_NOTIFICACION.find((s) => s.evento === TIPO);
  assert.ok(suscripcion);
  assert.equal(suscripcion.prioridad_default, "INFORMATIVA");
  assert.deepEqual(suscripcion.armar(payload), {
    clave_origen: payload.evento_id,
    variables: { numero_venta: pedido.numero_venta },
    destinatarios: { cuenta_cliente_web_ids: [cuenta.id] },
  });
  assert.equal(SUSCRIPCIONES_NOTIFICACION.some((s) => s.evento === "ecommerce:pedido_entregado"), false);

  const clave = (eventoId: string) => createHash("sha256")
    .update(`${TIPO}:${eventoId}:${cuenta.id}`).digest("hex");
  async function esperarCantidad(cantidad: number) {
    for (let intento = 0; intento < 40; intento++) {
      const filas = await prisma.notificacion.findMany({
        where: { tipo_evento: TIPO, cuenta_cliente_web_destinatario_id: cuenta.id },
        orderBy: { created_at: "asc" },
      });
      if (filas.length >= cantidad) return filas;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("No se materializó la notificación interna");
  }

  await t.test("misma ocurrencia y destinatario producen una sola fila", async () => {
    domainEventBus.emit(TIPO, payload);
    const primera = await esperarCantidad(1);
    assert.equal(primera[0].clave_idempotencia, clave(payload.evento_id));
    assert.equal(primera[0].prioridad, "INFORMATIVA");
    assert.ok(primera[0].cuerpo.includes(pedido.numero_venta));
    domainEventBus.emit(TIPO, payload);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const filas = await prisma.notificacion.findMany({
      where: { tipo_evento: TIPO, cuenta_cliente_web_destinatario_id: cuenta.id },
    });
    assert.equal(filas.length, 1);
  });

  await t.test("otra ocurrencia conserva clave distinta; sin destinatario omite F3", async () => {
    const otra = { ...payload, evento_id: randomUUID() };
    domainEventBus.emit(TIPO, otra);
    const filas = await esperarCantidad(2);
    assert.ok(filas.some((fila) => fila.clave_idempotencia === clave(otra.evento_id)));
    const sinCuenta = { ...payload, evento_id: randomUUID(), cliente_web_cuenta_id: null };
    assert.equal(suscripcion.armar(sinCuenta), null);
    domainEventBus.emit(TIPO, sinCuenta);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await prisma.notificacion.count({
      where: { tipo_evento: TIPO, cuenta_cliente_web_destinatario_id: cuenta.id },
    }), 2);
  });

  await t.test("pedido_entregado no tiene consumidor F3", async () => {
    const entregado: PedidoEntregadoPayload = {
      evento_id: randomUUID(), pedido_venta_id: pedido.id, pedido_venta_ecommerce_id: extension.id,
      actor_id: actor.id, estado_anterior: "LISTO_PARA_RETIRO", estado_nuevo: "ENTREGADO",
      timestamp: new Date().toISOString(),
    };
    domainEventBus.emit("ecommerce:pedido_entregado", entregado);
    assert.equal(await prisma.notificacion.count({
      where: { cuenta_cliente_web_destinatario_id: cuenta.id },
    }), 2);
  });
});
