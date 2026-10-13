import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T15_INTEGRATION_DATABASE_URL;

test("HU-E13 T15 — lectura administrativa durable de pedidos pagados", {
  skip: !DATABASE_URL,
  timeout: 300_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.APP_PUBLIC_URL = "http://localhost:3000";
  process.env.MP_MODO = "simulado";
  const [{ prisma }, fixtures, carrito, checkout, pagoWeb, lectura] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./hu-e1.test-fixtures.ts"),
    import("./carrito.service.ts"),
    import("./checkout.service.ts"),
    import("./pago-web.service.ts"),
    import("./pedidos-pagados-admin.service.ts"),
  ]);
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await prisma.$disconnect();
  });

  const totalAntes = (await lectura.listarPedidosPagadosAdmin({ page_size: 1 })).total;

  async function compraPagada() {
    const cuenta = await fixtures.crearCuenta(prisma);
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 10, precio: 5000 });
    await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 1 });
    const pedido = await checkout.iniciarCheckout(cuenta.sesion);
    const paymentId = `t15-${randomUUID()}`;
    assert.equal((await pagoWeb.procesarNotificacionPago(paymentId, {
      consultarPago: async () => ({
        payment_id: paymentId,
        estado: "APROBADO",
        status_mp: "approved",
        status_detail: "accredited",
        monto: pedido.total,
        moneda: "ARS",
        external_reference: pedido.pedido_venta_ecommerce_id,
        fecha_aprobacion: new Date().toISOString(),
      }),
      cerrarCobro: async () => undefined,
    })).resultado, "CONFIRMADO");
    return { ...pedido, paymentId };
  }

  const pagoConfirmado = await compraPagada();
  const enPreparacion = await compraPagada();
  const listo = await compraPagada();
  const canceladoRechazado = await compraPagada();
  const vencidoConPendiente = await compraPagada();
  const canceladoAprobado = await compraPagada();
  const pagoPendiente = await compraPagada();
  const pagoRechazado = await compraPagada();
  const entregado = await compraPagada();
  const anulado = await compraPagada();

  const visibles = [pagoConfirmado, enPreparacion, listo, canceladoRechazado, vencidoConPendiente, canceladoAprobado];
  const estados = [
    "PAGO_CONFIRMADO",
    "EN_PREPARACION",
    "LISTO_PARA_RETIRO",
    "CANCELADO",
    "VENCIDO_SIN_RETIRO",
    "CANCELADO",
  ] as const;
  for (let i = 0; i < visibles.length; i++) {
    const terminal = estados[i] === "CANCELADO" || estados[i] === "VENCIDO_SIN_RETIRO";
    await prisma.pedidoVentaEcommerce.update({
      where: { pedido_venta_id: visibles[i]!.pedido_venta_id },
      data: {
        estado_ecommerce: estados[i],
        plazo_retiro_vencimiento: estados[i] === "LISTO_PARA_RETIRO" ? new Date("2026-12-01T12:00:00Z") : null,
        is_active: !terminal,
        deleted_at: terminal ? new Date() : null,
        deletion_reason: terminal ? "T15 lectura" : null,
        created_at: new Date(Date.UTC(2099, 0, 1, 0, -i)),
      },
    });
  }
  for (const [pedido, estado] of [[pagoPendiente, "PAGO_PENDIENTE"], [pagoRechazado, "PAGO_RECHAZADO"], [entregado, "ENTREGADO"]] as const) {
    await prisma.pedidoVentaEcommerce.update({ where: { pedido_venta_id: pedido.pedido_venta_id }, data: { estado_ecommerce: estado } });
  }
  await prisma.pedidoVentaEcommerce.update({
    where: { pedido_venta_id: anulado.pedido_venta_id },
    data: { estado_ecommerce: "ANULADO", is_active: false, deleted_at: new Date(), deletion_reason: "Legacy" },
  });

  async function saga(pedido: typeof pagoConfirmado, estado: "PENDIENTE" | "APROBADO" | "RECHAZADO", intentoPendiente: boolean) {
    const reintegro = await prisma.reintegroPedidoWeb.create({
      data: {
        pedido_venta_id: pedido.pedido_venta_id,
        mercadopago_payment_id: pedido.paymentId,
        estado,
        monto_total: pedido.total,
        motivo: "Fixture lectura T15",
        solicitado_por_tipo: "SISTEMA",
      },
    });
    if (intentoPendiente) {
      await prisma.reintegroRefundIntento.create({
        data: {
          reintegro_id: reintegro.id,
          numero: 1,
          origen: "INICIAL",
          clave_idempotencia: `T15:${randomUUID()}`,
          estado: "PENDIENTE",
        },
      });
    }
  }
  await saga(enPreparacion, "PENDIENTE", true);
  await saga(canceladoRechazado, "RECHAZADO", false);
  await saga(vencidoConPendiente, "RECHAZADO", true);
  await saga(canceladoAprobado, "APROBADO", false);

  await t.test("filtra estados y soft-delete antes de count, orden y páginas", async () => {
    const paginas = await Promise.all([1, 2, 3].map((page) => lectura.listarPedidosPagadosAdmin({ page, page_size: 2 })));
    assert.deepEqual(paginas.map((pagina) => pagina.total), [totalAntes + 6, totalAntes + 6, totalAntes + 6]);
    const items = paginas.flatMap((pagina) => pagina.items);
    assert.equal(items.length, 6);
    assert.equal(new Set(items.map((item) => item.pedido_venta_id)).size, 6);
    assert.deepEqual(items.map((item) => item.pedido_venta_id), visibles.map((pedido) => pedido.pedido_venta_id));
    for (const excluido of [pagoPendiente, pagoRechazado, entregado, anulado]) {
      assert.equal(items.some((item) => item.pedido_venta_id === excluido.pedido_venta_id), false);
    }
  });

  await t.test("calcula DTO, cancelación y retry desde evidencia durable", async () => {
    const pagina = await lectura.listarPedidosPagadosAdmin({ page_size: 20 });
    const porId = new Map(pagina.items.map((item) => [item.pedido_venta_id, item]));
    for (const pedido of [pagoConfirmado, enPreparacion, listo]) assert.equal(porId.get(pedido.pedido_venta_id)?.acciones.cancelar_pedido, true);
    for (const pedido of [canceladoRechazado, vencidoConPendiente, canceladoAprobado]) assert.equal(porId.get(pedido.pedido_venta_id)?.acciones.cancelar_pedido, false);
    assert.equal(porId.get(pagoConfirmado.pedido_venta_id)?.reintegro, null);
    assert.deepEqual(porId.get(enPreparacion.pedido_venta_id)?.reintegro, { estado: "PENDIENTE", tiene_intento_pendiente: true });
    assert.equal(porId.get(enPreparacion.pedido_venta_id)?.acciones.reintentar_reintegro, false);
    assert.deepEqual(porId.get(canceladoRechazado.pedido_venta_id)?.reintegro, { estado: "RECHAZADO", tiene_intento_pendiente: false });
    assert.equal(porId.get(canceladoRechazado.pedido_venta_id)?.acciones.reintentar_reintegro, true);
    assert.deepEqual(porId.get(vencidoConPendiente.pedido_venta_id)?.reintegro, { estado: "RECHAZADO", tiene_intento_pendiente: true });
    assert.equal(porId.get(vencidoConPendiente.pedido_venta_id)?.acciones.reintentar_reintegro, false);
    assert.deepEqual(porId.get(canceladoAprobado.pedido_venta_id)?.reintegro, { estado: "APROBADO", tiene_intento_pendiente: false });
    assert.equal(porId.get(canceladoAprobado.pedido_venta_id)?.acciones.reintentar_reintegro, false);
    const serializado = JSON.stringify(pagina);
    assert.doesNotMatch(serializado, /mercadopago|refund_id|clave_idempotencia|nota_credito|contra_asiento|ultimo_error|solicitado_por|motivo/i);
  });
});
