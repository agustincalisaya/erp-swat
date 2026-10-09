import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T13_INTEGRATION_DATABASE_URL;

test("HU-E13 T13 — historial E9 de CANCELADO y VENCIDO_SIN_RETIRO", {
  skip: !DATABASE_URL,
  timeout: 240_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.APP_PUBLIC_URL = "http://localhost:3000";
  process.env.MP_MODO = "simulado";
  const [{ prisma }, fixtures, carrito, checkout, pagoWeb, reintegro, misPedidos] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./hu-e1.test-fixtures.ts"),
    import("./carrito.service.ts"),
    import("./checkout.service.ts"),
    import("./pago-web.service.ts"),
    import("./reintegro-pedido-web.service.ts"),
    import("./mis-pedidos.service.ts"),
  ]);
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await prisma.$disconnect();
  });

  async function compraPagada(cuenta?: Awaited<ReturnType<typeof fixtures.crearCuenta>>) {
    const propia = cuenta ?? await fixtures.crearCuenta(prisma);
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 10, precio: 5000 });
    await carrito.agregarAlCarrito({ cuentaId: propia.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 1 });
    const pedido = await checkout.iniciarCheckout(propia.sesion);
    const paymentId = `t13-${randomUUID()}`;
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
    for (let i = 0; i < 50; i++) {
      if (await prisma.ingresoTesoreria.count({ where: { pedido_venta_id: pedido.pedido_venta_id } })) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { ...pedido, cuenta: propia };
  }

  const cuentaPropia = await fixtures.crearCuenta(prisma);
  const cuentaAjena = await fixtures.crearCuenta(prisma);
  const activos: Awaited<ReturnType<typeof compraPagada>>[] = [];
  for (let i = 0; i < 3; i++) activos.push(await compraPagada(cuentaPropia));
  const cancelado = await compraPagada(cuentaPropia);
  const vencido = await compraPagada(cuentaPropia);
  const legacyAnulado = await compraPagada(cuentaPropia);
  const inactivoNoPermitido = await compraPagada(cuentaPropia);
  const canceladoAjeno = await compraPagada(cuentaAjena);
  const vencidoAjeno = await compraPagada(cuentaAjena);

  await reintegro.iniciarReintegroPedidoWebPaso0({
    pedido_venta_id: cancelado.pedido_venta_id,
    causa: "CANCELACION_CLIENTE",
    cliente_web_cuenta_id: cuentaPropia.cuentaId,
    motivo: "Histórico T13",
  });
  await reintegro.iniciarReintegroPedidoWebPaso0({
    pedido_venta_id: canceladoAjeno.pedido_venta_id,
    causa: "CANCELACION_CLIENTE",
    cliente_web_cuenta_id: cuentaAjena.cuentaId,
    motivo: "Histórico ajeno T13",
  });

  for (const pedido of [vencido, vencidoAjeno]) {
    await prisma.pedidoVentaEcommerce.update({
      where: { pedido_venta_id: pedido.pedido_venta_id },
      data: {
        estado_ecommerce: "LISTO_PARA_RETIRO",
        codigo_qr_retiro: `qr-${randomUUID()}`,
        plazo_retiro_vencimiento: new Date(Date.now() - 60_000),
      },
    });
    await reintegro.iniciarReintegroPedidoWebPaso0({ causa: "VENCIMIENTO", pedido_venta_id: pedido.pedido_venta_id });
  }

  const baja = new Date();
  await prisma.pedidoVentaEcommerce.update({
    where: { pedido_venta_id: legacyAnulado.pedido_venta_id },
    data: { estado_ecommerce: "ANULADO", is_active: false, deleted_at: baja, deletion_reason: "Legacy T13" },
  });
  await prisma.pedidoVentaEcommerce.update({
    where: { pedido_venta_id: inactivoNoPermitido.pedido_venta_id },
    data: { estado_ecommerce: "PAGO_CONFIRMADO", is_active: false, deleted_at: baja, deletion_reason: "Inconsistente T13" },
  });

  const ordenEsperado = [...activos.map((pedido) => pedido.pedido_venta_id), cancelado.pedido_venta_id, vencido.pedido_venta_id];
  for (let i = 0; i < ordenEsperado.length; i++) {
    await prisma.pedidoVenta.update({
      where: { id: ordenEsperado[i]! },
      data: { created_at: new Date(Date.now() - i * 60_000) },
    });
  }

  await t.test("listado filtra antes de ordenar/paginar y conserva total", async () => {
    const paginas = await Promise.all([1, 2, 3].map((pagina) =>
      misPedidos.listarPedidosWebCliente(cuentaPropia.clienteId, { pagina, porPagina: 2 })));
    assert.equal(paginas[0]!.total, 5);
    assert.equal(paginas[1]!.total, 5);
    assert.equal(paginas[2]!.total, 5);
    const ids = paginas.flatMap((pagina) => pagina.pedidos.map((pedido) => pedido.id));
    assert.deepEqual(ids, ordenEsperado);
    assert.equal(new Set(ids).size, ids.length);
    for (const excluido of [legacyAnulado, inactivoNoPermitido, canceladoAjeno, vencidoAjeno]) {
      assert.equal(ids.includes(excluido.pedido_venta_id), false);
    }
  });

  await t.test("detalle histórico propio es visible y no expone QR ni saga", async () => {
    for (const pedido of [cancelado, vencido]) {
      const extensionAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
      assert.equal(extensionAntes.is_active, false);
      assert.ok(extensionAntes.deleted_at);
      const detalle = await misPedidos.obtenerPedidoWebCliente(cuentaPropia.clienteId, pedido.pedido_venta_id);
      assert.equal(detalle.qr_data_url, null);
      assert.ok(["CANCELADO", "VENCIDO_SIN_RETIRO"].includes(detalle.estado));
      const serializado = JSON.stringify(detalle);
      // Post-T17: `reintegro_estado`/`nota_credito` son contrato; IDs y datos técnicos siguen prohibidos.
      assert.doesNotMatch(serializado, /reintegro_id|refund|contra_asiento|mercadopago|clave_idempotencia|ultimo_error|intento/i);
      const extensionDespues = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
      assert.equal(extensionDespues.is_active, false);
      assert.equal(extensionDespues.deleted_at?.getTime(), extensionAntes.deleted_at?.getTime());
    }
    const sagaCancelada = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: cancelado.pedido_venta_id } });
    assert.equal(sagaCancelada.estado, "PENDIENTE");
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: sagaCancelada.id } }), 0);
  });

  await t.test("ownership y otros inactivos mantienen 404", async () => {
    for (const pedido of [canceladoAjeno, vencidoAjeno, legacyAnulado, inactivoNoPermitido]) {
      await assert.rejects(
        () => misPedidos.obtenerPedidoWebCliente(cuentaPropia.clienteId, pedido.pedido_venta_id),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "PEDIDO_NO_ENCONTRADO",
      );
    }
  });

  // ── Post-T17 (SPEC §2.13.16.2–§2.13.16.3) ─────────────────────────────────
  const { crearServicioReintegroRefund } = await import("./reintegro-refund.service.ts");
  const resultadoRefund = (estado: "APROBADO" | "RECHAZADO") => crearServicioReintegroRefund({
    solicitarReembolso: async (paymentId: string, key: string) => {
      const intento = await prisma.reintegroRefundIntento.findUniqueOrThrow({
        where: { clave_idempotencia: key },
        select: { reintegro: { select: { monto_total: true } } },
      });
      return {
        refund_id: `t13-refund-${randomUUID()}`,
        payment_id: paymentId,
        monto: intento.reintegro.monto_total.toNumber(),
        estado,
      };
    },
  });
  const cuentaPost = await fixtures.crearCuenta(prisma);
  const noEncontrado = (codigo: string) => (error: unknown) =>
    error instanceof Error && "code" in error && error.code === codigo;

  async function secretosDe(pedidoId: string): Promise<string[]> {
    const saga = await prisma.reintegroPedidoWeb.findUnique({
      where: { pedido_venta_id: pedidoId },
      include: { intentos_refund: true },
    });
    const comprobantes = await prisma.comprobanteFiscal.findMany({ where: { pedido_venta_id: pedidoId } });
    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pedidoId } });
    return [
      ...comprobantes.flatMap((c) => [c.id, c.cae_simulado]),
      extension.mercadopago_payment_id ?? "",
      ...(saga ? [saga.id, saga.mercadopago_payment_id, saga.contra_asiento_ingreso_id ?? "", saga.nota_credito_id ?? ""] : []),
      ...(saga?.intentos_refund.flatMap((i) => [i.id, i.clave_idempotencia, i.refund_id ?? "", i.error_codigo ?? ""]) ?? []),
    ].filter((valor) => valor.length > 0);
  }

  function assertSinSecretos(detalle: unknown, secretos: string[]): void {
    const serializado = JSON.stringify(detalle);
    for (const secreto of secretos) assert.ok(!serializado.includes(secreto), "E9 expone un identificador interno");
    assert.doesNotMatch(serializado, /reintegro_id|intento|refund|mercadopago|clave_idempotencia|ultimo_error|contra_asiento|HU-E13:/i);
  }

  await t.test("post-T17 A+F+factura/NC: CANCELADO con NC y refund APROBADO", async () => {
    const compra = await compraPagada(cuentaPost);
    const original = await prisma.comprobanteFiscal.findFirstOrThrow({
      where: { pedido_venta_id: compra.pedido_venta_id, tipo_comprobante: { not: "NOTA_CREDITO" } },
    });
    const { inicio, pasos_locales: pasos } = await reintegro.iniciarYContinuarReintegroPedidoWeb({
      pedido_venta_id: compra.pedido_venta_id,
      causa: "CANCELACION_CLIENTE",
      cliente_web_cuenta_id: cuentaPost.cuentaId,
      motivo: "Me equivoqué de talle T13",
    });
    assert.ok(pasos.nota_credito_id, "la saga debe emitir realmente la NC");
    assert.equal((await resultadoRefund("APROBADO").continuarRefundPedidoWeb(inicio.reintegro_id)).resultado, "APROBADO");

    const nc = await prisma.comprobanteFiscal.findUniqueOrThrow({ where: { id: pasos.nota_credito_id! } });
    assert.equal(nc.tipo_comprobante, "NOTA_CREDITO");
    assert.equal(nc.pedido_venta_id, compra.pedido_venta_id);
    assert.equal(nc.comprobante_original_id, original.id);
    assert.deepEqual(await prisma.comprobanteFiscal.findUniqueOrThrow({ where: { id: original.id } }), original);

    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: compra.pedido_venta_id } });
    const detalle = await misPedidos.obtenerPedidoWebCliente(cuentaPost.clienteId, compra.pedido_venta_id);
    assert.equal(detalle.estado, "CANCELADO");
    assert.equal(detalle.motivo, "Me equivoqué de talle T13");
    assert.equal(detalle.motivo, extension.deletion_reason);
    assert.equal(detalle.fecha_terminacion, extension.deleted_at!.toISOString());
    assert.equal(detalle.reintegro_estado, "APROBADO");
    assert.deepEqual(detalle.comprobante, {
      tipo: original.tipo_comprobante,
      fecha_emision: original.created_at.toISOString(),
      monto: original.monto_total.toNumber(),
    });
    assert.notEqual(detalle.comprobante!.tipo, "NOTA_CREDITO");
    assert.deepEqual(detalle.nota_credito, {
      tipo: "NOTA_CREDITO",
      fecha_emision: nc.created_at.toISOString(),
      monto: nc.monto_total.toNumber(),
    });
    assert.equal(detalle.nota_credito!.monto, detalle.comprobante!.monto);
    assert.equal(detalle.qr_data_url, null);
    assertSinSecretos(detalle, await secretosDe(compra.pedido_venta_id));
  });

  await t.test("post-T17 B+E: VENCIDO con NC y refund RECHAZADO", async () => {
    const compra = await compraPagada(cuentaPost);
    // Precondición documentada (igual que el bloque T13 anterior): LISTO con plazo ya vencido.
    await prisma.pedidoVentaEcommerce.update({
      where: { pedido_venta_id: compra.pedido_venta_id },
      data: {
        estado_ecommerce: "LISTO_PARA_RETIRO",
        codigo_qr_retiro: `qr-${randomUUID()}`,
        plazo_retiro_vencimiento: new Date(Date.now() - 60_000),
      },
    });
    const { inicio, pasos_locales: pasos } = await reintegro.iniciarYContinuarReintegroPedidoWeb({
      causa: "VENCIMIENTO",
      pedido_venta_id: compra.pedido_venta_id,
    });
    assert.ok(pasos.nota_credito_id);
    assert.equal((await resultadoRefund("RECHAZADO").continuarRefundPedidoWeb(inicio.reintegro_id)).resultado, "RECHAZADO");

    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: compra.pedido_venta_id } });
    const detalle = await misPedidos.obtenerPedidoWebCliente(cuentaPost.clienteId, compra.pedido_venta_id);
    assert.equal(detalle.estado, "VENCIDO_SIN_RETIRO");
    assert.equal(detalle.motivo, "Plazo de retiro vencido");
    assert.equal(detalle.fecha_terminacion, extension.deleted_at!.toISOString());
    assert.equal(detalle.reintegro_estado, "RECHAZADO");
    assert.notEqual(detalle.comprobante?.tipo, "NOTA_CREDITO");
    assert.equal(detalle.nota_credito?.tipo, "NOTA_CREDITO");
    assert.equal(detalle.qr_data_url, null);
    assertSinSecretos(detalle, await secretosDe(compra.pedido_venta_id));
  });

  await t.test("post-T17 C+D: activo sin saga y saga PENDIENTE sin NC todavía", async () => {
    const activo = await misPedidos.obtenerPedidoWebCliente(cuentaPropia.clienteId, activos[0]!.pedido_venta_id);
    assert.equal(activo.motivo, null);
    assert.equal(activo.fecha_terminacion, null);
    assert.equal(activo.reintegro_estado, null);
    assert.equal(activo.nota_credito, null);
    assert.ok(activo.comprobante);

    const pendiente = await misPedidos.obtenerPedidoWebCliente(cuentaPropia.clienteId, cancelado.pedido_venta_id);
    assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({
      where: { pedido_venta_id: cancelado.pedido_venta_id },
    })).estado, "PENDIENTE");
    assert.equal(pendiente.reintegro_estado, "PENDIENTE");
    assert.equal(pendiente.motivo, "Histórico T13");
    assert.ok(pendiente.fecha_terminacion);
    assert.equal(pendiente.nota_credito, null);
    assert.notEqual(pendiente.comprobante?.tipo, "NOTA_CREDITO");
    assertSinSecretos(pendiente, await secretosDe(cancelado.pedido_venta_id));
  });

  await t.test("post-T17: comprobante individual visible en terminales propios; ajeno y ANULADO 404", async () => {
    const comprobantesDe = (pedidoId: string) => prisma.comprobanteFiscal.findMany({
      where: { pedido_venta_id: pedidoId },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
    const pedidosPost = await prisma.pedidoVenta.findMany({
      where: { cliente_id: cuentaPost.clienteId, canal: "WEB" },
      select: { id: true, ecommerce: { select: { estado_ecommerce: true } } },
    });
    const terminales = pedidosPost.filter((p) => ["CANCELADO", "VENCIDO_SIN_RETIRO"].includes(p.ecommerce!.estado_ecommerce));
    assert.equal(terminales.length, 2);
    for (const pedido of terminales) {
      const comprobantes = await comprobantesDe(pedido.id);
      assert.equal(comprobantes.length, 2);
      for (const comprobante of comprobantes) {
        assert.deepEqual(
          await misPedidos.obtenerComprobanteWebCliente(cuentaPost.clienteId, pedido.id, comprobante.id),
          { tipo: comprobante.tipo_comprobante, fecha_emision: comprobante.created_at.toISOString(), monto: comprobante.monto_total.toNumber() },
        );
        await assert.rejects(
          () => misPedidos.obtenerComprobanteWebCliente(cuentaAjena.clienteId, pedido.id, comprobante.id),
          noEncontrado("COMPROBANTE_NO_ENCONTRADO"),
        );
      }
    }
    for (const [cuenta, pedido] of [[cuentaPropia, vencido], [cuentaPropia, cancelado]] as const) {
      const [factura] = await comprobantesDe(pedido.pedido_venta_id);
      assert.ok(await misPedidos.obtenerComprobanteWebCliente(cuenta.clienteId, pedido.pedido_venta_id, factura!.id));
    }
    for (const pedido of [canceladoAjeno, vencidoAjeno, legacyAnulado, inactivoNoPermitido]) {
      const [factura] = await comprobantesDe(pedido.pedido_venta_id);
      await assert.rejects(
        () => misPedidos.obtenerComprobanteWebCliente(cuentaPropia.clienteId, pedido.pedido_venta_id, factura!.id),
        noEncontrado("COMPROBANTE_NO_ENCONTRADO"),
      );
    }
  });
});
