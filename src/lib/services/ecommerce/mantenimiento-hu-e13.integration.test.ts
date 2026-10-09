import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T12_INTEGRATION_DATABASE_URL;

test("HU-E13 T12 — recordatorios, vencimientos y retries", {
  skip: !DATABASE_URL,
  timeout: 300_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MP_MODO = "simulado";
  process.env.APP_PUBLIC_URL = "http://localhost:3000";
  const [{ prisma }, fixtures, carrito, checkout, pagoWeb, mantenimiento, programado, retiro, { domainEventBus, listenersRegistrados }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./hu-e1.test-fixtures.ts"),
    import("./carrito.service.ts"),
    import("./checkout.service.ts"),
    import("./pago-web.service.ts"),
    import("./mantenimiento-hu-e13.service.ts"),
    import("./mantenimiento-programado.ts"),
    import("./retiro-e3.service.ts"),
    import("../../events/domain-event-bus.ts"),
  ]);
  await listenersRegistrados;
  t.after(() => prisma.$disconnect());
  const admin = await prisma.usuario.findFirstOrThrow({ where: { is_active: true, deleted_at: null }, select: { id: true } });
  const ahoraBase = new Date();

  async function configurar(dias = "10", horas = "24") {
    await prisma.configuracionSistema.upsert({
      where: { clave: "ECOMMERCE_PLAZO_RETIRO_DIAS" },
      update: { valor: dias, actualizado_por_id: admin.id },
      create: { clave: "ECOMMERCE_PLAZO_RETIRO_DIAS", valor: dias, modulo: "E", actualizado_por_id: admin.id },
    });
    await prisma.configuracionSistema.upsert({
      where: { clave: "ECOMMERCE_RECORDATORIO_RETIRO_HORAS" },
      update: { valor: horas, actualizado_por_id: admin.id },
      create: { clave: "ECOMMERCE_RECORDATORIO_RETIRO_HORAS", valor: horas, modulo: "E", actualizado_por_id: admin.id },
    });
  }

  async function compraPagada() {
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 10, precio: 5000 });
    const cuenta = await fixtures.crearCuenta(prisma);
    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: cuenta.clienteId }, select: { dni: true } });
    await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 1 });
    const pedido = await checkout.iniciarCheckout(cuenta.sesion);
    const paymentId = `t12-${randomUUID()}`;
    assert.equal((await pagoWeb.procesarNotificacionPago(paymentId, {
      consultarPago: async () => ({
        payment_id: paymentId,
        estado: "APROBADO",
        status_mp: "approved",
        status_detail: "accredited",
        monto: pedido.total,
        moneda: "ARS",
        external_reference: pedido.pedido_venta_ecommerce_id,
        fecha_aprobacion: ahoraBase.toISOString(),
      }),
      cerrarCobro: async () => undefined,
    })).resultado, "CONFIRMADO");
    for (let i = 0; i < 50; i++) {
      if (await prisma.ingresoTesoreria.count({ where: { pedido_venta_id: pedido.pedido_venta_id } })) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { ...pedido, cuenta, dni: cliente.dni };
  }

  async function listo(plazo: Date) {
    const pedido = await compraPagada();
    const qr = `T12-${randomUUID()}`;
    await prisma.pedidoVentaEcommerce.update({
      where: { pedido_venta_id: pedido.pedido_venta_id },
      data: { estado_ecommerce: "LISTO_PARA_RETIRO", codigo_qr_retiro: qr, plazo_retiro_vencimiento: plazo },
    });
    return { ...pedido, qr };
  }

  async function esperarHechos(cuentaId: string) {
    for (let i = 0; i < 100; i++) {
      const notificaciones = await prisma.notificacion.count({
        where: { tipo_evento: "ecommerce:plazo_retiro_por_vencer", cuenta_cliente_web_destinatario_id: cuentaId },
      });
      if (notificaciones > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  await configurar();

  await t.test("coordinador aísla las tres ramas HU-E13", async () => {
    const errorOriginal = console.error;
    console.error = () => undefined;
    try {
      const resultado = await programado.ejecutarMantenimientoProgramado(ahoraBase, {
        liberarReservasVencidas: async () => ({}) as never,
        ejecutarMantenimientoCupones: async () => ({}) as never,
        desactivarCarritosAbandonados: async () => ({}) as never,
        procesarRecordatoriosRetiroHuE13: async () => { throw new Error("recordatorio defectuoso"); },
        procesarVencimientosRetiroHuE13: async () => ({ procesados: 1, vencidos: 1, refunds_iniciados: 1, errores: [] }),
        procesarRetriesRefundHuE13: async () => ({ procesados: 1, refunds_reintentados: 1, errores: [] }),
      });
      assert.equal(resultado.recordatorios_hu_e13.ok, false);
      assert.equal(resultado.vencimientos_hu_e13.ok, true);
      assert.equal(resultado.retries_hu_e13.ok, true);
    } finally {
      console.error = errorOriginal;
    }
  });

  await t.test("recordatorio respeta ventana, identidad estable y cuenta inactiva", async () => {
    const antes = await listo(new Date(ahoraBase.getTime() + 25 * 60 * 60_000));
    const inicio = await listo(new Date(ahoraBase.getTime() + 24 * 60 * 60_000));
    const dentro = await listo(new Date(ahoraBase.getTime() + 12 * 60 * 60_000));
    const inactiva = await listo(new Date(ahoraBase.getTime() + 6 * 60 * 60_000));
    await prisma.cuentaClienteWeb.update({ where: { id: inactiva.cuenta.cuentaId }, data: { is_active: false, deleted_at: ahoraBase } });
    const eventos: Record<string, unknown>[] = [];
    const listener = (payload: unknown) => eventos.push(payload as Record<string, unknown>);
    domainEventBus.on("ecommerce:plazo_retiro_por_vencer", listener as never);
    try {
      await mantenimiento.procesarRecordatoriosRetiroHuE13(ahoraBase);
      await mantenimiento.procesarRecordatoriosRetiroHuE13(ahoraBase);
      await esperarHechos(inicio.cuenta.cuentaId);
    } finally {
      domainEventBus.off("ecommerce:plazo_retiro_por_vencer", listener as never);
    }
    assert.equal(eventos.some((e) => e.pedido_venta_id === antes.pedido_venta_id), false);
    for (const pedido of [inicio, dentro]) {
      const propios = eventos.filter((e) => e.pedido_venta_id === pedido.pedido_venta_id);
      assert.equal(propios.length, 2);
      assert.equal(new Set(propios.map((e) => e.evento_id)).size, 1);
      assert.equal(await prisma.notificacion.count({ where: {
        tipo_evento: "ecommerce:plazo_retiro_por_vencer",
        cuenta_cliente_web_destinatario_id: pedido.cuenta.cuentaId,
      } }), 1);
      const claveOrigen = propios[0]!.clave_origen as string;
      for (let i = 0; i < 100; i++) {
        if (await prisma.auditLog.count({ where: { accion: "PLAZO_RETIRO_POR_VENCER", registro_id: claveOrigen } })) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(await prisma.auditLog.count({ where: {
        accion: "PLAZO_RETIRO_POR_VENCER",
        registro_id: claveOrigen,
      } }), 1);
    }
    const eventoInactiva = eventos.find((e) => e.pedido_venta_id === inactiva.pedido_venta_id);
    assert.equal(eventoInactiva?.cliente_web_cuenta_id, null);
    assert.equal(await prisma.notificacion.count({ where: {
      tipo_evento: "ecommerce:plazo_retiro_por_vencer",
      cuenta_cliente_web_destinatario_id: inactiva.cuenta.cuentaId,
    } }), 0);
  });

  await t.test("configuración inválida aísla recordatorios y no muta pedidos", async () => {
    const pedido = await listo(new Date(ahoraBase.getTime() + 12 * 60 * 60_000));
    await configurar("1", "24");
    await assert.rejects(() => mantenimiento.procesarRecordatoriosRetiroHuE13(ahoraBase),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CONFIGURACION_INVALIDA");
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } })).estado_ecommerce, "LISTO_PARA_RETIRO");
    await configurar();
  });

  await t.test("vencimiento estricto crea saga, consume QR e inicia un intento", async () => {
    const igualdad = await listo(ahoraBase);
    const futuro = await listo(new Date(ahoraBase.getTime() + 1));
    const vencido = await listo(new Date(ahoraBase.getTime() - 1));
    const resultado = await mantenimiento.procesarVencimientosRetiroHuE13(ahoraBase);
    assert.ok(resultado.vencidos >= 1);
    for (const pedidoId of [igualdad.pedido_venta_id, futuro.pedido_venta_id]) {
      assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pedidoId } })).estado_ecommerce, "LISTO_PARA_RETIRO");
    }
    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: vencido.pedido_venta_id } });
    assert.equal(extension.estado_ecommerce, "VENCIDO_SIN_RETIRO");
    assert.equal(extension.codigo_qr_retiro, null);
    assert.equal((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: vencido.pedido_venta_id } })).estado, "FACTURADO");
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: vencido.pedido_venta_id } });
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: saga.id, origen: "INICIAL" } }), 1);
  });

  await t.test("dos workers de vencimiento reutilizan saga e intento inicial", async () => {
    const pedido = await listo(new Date(ahoraBase.getTime() - 60_000));
    await Promise.all([
      mantenimiento.procesarVencimientosRetiroHuE13(ahoraBase),
      mantenimiento.procesarVencimientosRetiroHuE13(ahoraBase),
    ]);
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: pedido.pedido_venta_id } }), 1);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: saga.id, origen: "INICIAL" } }), 1);
    assert.equal(await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: pedido.pedido_venta_id, tipo_comprobante: "NOTA_CREDITO" } }), 1);
    assert.equal(await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: pedido.pedido_venta_id } }), 1);
  });

  await t.test("E3 y vencimiento son excluyentes bajo locks", async () => {
    const pedido = await listo(new Date(ahoraBase.getTime() - 60_000));
    await Promise.allSettled([
      retiro.validarYEntregarRetiro({ qr_token: pedido.qr, dni: pedido.dni }, admin.id),
      mantenimiento.procesarVencimientosRetiroHuE13(ahoraBase),
    ]);
    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
    const saga = await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: pedido.pedido_venta_id } });
    const venta = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pedido.pedido_venta_id } });
    if (extension.estado_ecommerce === "ENTREGADO") {
      assert.equal(venta.estado, "CERRADO");
      assert.equal(saga, 0);
    } else {
      assert.equal(extension.estado_ecommerce, "VENCIDO_SIN_RETIRO");
      assert.equal(venta.estado, "FACTURADO");
      assert.equal(extension.codigo_qr_retiro, null);
      assert.equal(saga, 1);
    }
  });

  async function sagaConIntento(origen: "INICIAL" | "REINTENTO_MANUAL", proximo: Date) {
    const pedido = await listo(new Date(ahoraBase.getTime() - 60_000));
    await mantenimiento.procesarVencimientosRetiroHuE13(ahoraBase);
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
    const intento = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: saga.id } });
    await prisma.reintegroRefundIntento.update({
      where: { id: intento.id },
      data: { estado: "PENDIENTE", origen, refund_id: null, creado_por_id: origen === "REINTENTO_MANUAL" ? admin.id : null, motivo_reintento: origen === "REINTENTO_MANUAL" ? "Manual congelado" : null },
    });
    await prisma.reintegroPedidoWeb.update({
      where: { id: saga.id },
      data: { estado: "PENDIENTE", intento_aprobado_id: null, proximo_reintento_at: proximo, resuelto_at: null },
    });
    return { pedido, saga, intento: await prisma.reintegroRefundIntento.findUniqueOrThrow({ where: { id: intento.id } }) };
  }

  await t.test("selector retry respeta fecha, reutiliza intento inicial y manual", async () => {
    const futuro = await sagaConIntento("INICIAL", new Date(ahoraBase.getTime() + 60_000));
    await mantenimiento.procesarRetriesRefundHuE13(ahoraBase);
    assert.equal((await prisma.reintegroRefundIntento.findUniqueOrThrow({ where: { id: futuro.intento.id } })).estado, "PENDIENTE");

    for (const origen of ["INICIAL", "REINTENTO_MANUAL"] as const) {
      const debido = await sagaConIntento(origen, new Date(ahoraBase.getTime() - 1));
      const key = debido.intento.clave_idempotencia;
      const actor = debido.intento.creado_por_id;
      const motivo = debido.intento.motivo_reintento;
      await mantenimiento.procesarRetriesRefundHuE13(ahoraBase);
      const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: debido.saga.id } });
      assert.equal(intentos.length, 1);
      assert.equal(intentos[0]?.id, debido.intento.id);
      assert.equal(intentos[0]?.clave_idempotencia, key);
      assert.equal(intentos[0]?.creado_por_id, actor);
      assert.equal(intentos[0]?.motivo_reintento, motivo);
    }

    const concurrente = await sagaConIntento("INICIAL", new Date(ahoraBase.getTime() - 1));
    const keyConcurrente = concurrente.intento.clave_idempotencia;
    await Promise.all([
      mantenimiento.procesarRetriesRefundHuE13(ahoraBase),
      mantenimiento.procesarRetriesRefundHuE13(ahoraBase),
    ]);
    const intentosConcurrentes = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: concurrente.saga.id } });
    assert.equal(intentosConcurrentes.length, 1);
    assert.equal(intentosConcurrentes[0]?.id, concurrente.intento.id);
    assert.equal(intentosConcurrentes[0]?.clave_idempotencia, keyConcurrente);
  });

  await t.test("retry elegible sin intento pendiente reporta inconsistencia y no fabrica fila", async () => {
    const pedido = await listo(new Date(ahoraBase.getTime() - 60_000));
    await mantenimiento.procesarVencimientosRetiroHuE13(ahoraBase);
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
    await prisma.reintegroRefundIntento.updateMany({ where: { reintegro_id: saga.id }, data: { estado: "RECHAZADO" } });
    await prisma.reintegroPedidoWeb.update({ where: { id: saga.id }, data: { estado: "PENDIENTE", proximo_reintento_at: new Date(ahoraBase.getTime() - 1) } });
    const antes = await prisma.reintegroRefundIntento.count({ where: { reintegro_id: saga.id } });
    const resultado = await mantenimiento.procesarRetriesRefundHuE13(ahoraBase);
    assert.ok(resultado.errores.some((error) => error.pedido_venta_id === pedido.pedido_venta_id && error.codigo === "REINTEGRO_INCONSISTENTE"));
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: saga.id } }), antes);
  });
});
