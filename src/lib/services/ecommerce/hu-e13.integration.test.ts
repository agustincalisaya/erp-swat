import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * HU-E13 T17 — integración PostgreSQL end-to-end a nivel servicio + cron.
 *
 * Recorre con servicios productivos reales: pago E2 → PAGO_CONFIRMADO en cola
 * → toma E12 → scans → LISTO → recordatorio / vencimiento por el Route Handler
 * real del cron (T12) → saga T07/T08 (NC, stock A, G11, refund F1) → eventos
 * T09 (AuditLog/F3) → lecturas E9/T15. Mercado Pago se simula en la frontera
 * HTTP del adapter F1 real (`MP_MODO=real` + `fetch` determinista que respeta
 * `X-Idempotency-Key`). Las cancelaciones Cliente/Admin y el reintento manual
 * se cubren por HTTP real en `hu-e13.e2e.http.integration.test.ts`.
 *
 * Uso (base local migrada y sembrada, nombre `swat_erp_test_e13_*`):
 *   HU_E13_T17_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e13
 */
const DATABASE_URL = process.env.HU_E13_T17_INTEGRATION_DATABASE_URL;

test("HU-E13 T17 — circuito PostgreSQL real: pago, toma, preparación, recordatorio, vencimiento y refund", {
  skip: !DATABASE_URL,
  timeout: 900_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MP_MODO = "real";
  process.env.APP_PUBLIC_URL = "http://t17.local";
  const f = await import("./hu-e13.test-fixtures.ts");
  f.exigirDbDeTest(DATABASE_URL!);
  const mp = new f.MercadoPagoFake();
  mp.instalar();
  const [
    { prisma },
    pickPack,
    misPedidos,
    adminPagados,
    mantenimiento,
    retiro,
    auditoria,
    { listenersRegistrados },
    cronRoute,
    { NextRequest },
    { ServiceError },
  ] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./pick-pack.service.ts"),
    import("./mis-pedidos.service.ts"),
    import("./pedidos-pagados-admin.service.ts"),
    import("./mantenimiento-hu-e13.service.ts"),
    import("./retiro-e3.service.ts"),
    import("../auditoria/audit-log.service.ts"),
    import("../../events/domain-event-bus.ts"),
    import("../../../app/api/cron/check-pruebas-vencidas/route.ts"),
    import("next/server"),
    import("../../errors/service-error.ts"),
  ]);
  await listenersRegistrados;
  t.after(async () => {
    mp.desinstalar();
    await f.drenarListeners();
    await prisma.$disconnect();
  });

  const inicioSuite = new Date();
  const [operador, canalWeb] = await Promise.all([
    prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "operador.pickpack.seed" }, select: { id: true } }),
    prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "canal.web.sistema" }, select: { id: true } }),
  ]);
  const administradores = await f.usuariosConRol("ADMINISTRADOR_ECOMMERCE");
  assert.ok(administradores.length > 0, "el seed debe tener al menos un ADMINISTRADOR_ECOMMERCE");
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "admin.ecommerce.seed" }, select: { id: true } });
  // T02: la configuración HU-E13 debe existir; sobre un snapshot previo se siembra igual que el seed (upsert idempotente).
  for (const [clave, valor] of [["ECOMMERCE_PLAZO_RETIRO_DIAS", "10"], ["ECOMMERCE_RECORDATORIO_RETIRO_HORAS", "24"]] as const) {
    await prisma.configuracionSistema.upsert({
      where: { clave },
      update: {},
      create: { clave, valor, modulo: "E", actualizado_por_id: admin.id },
    });
  }
  // Un snapshot previo a HU-F1 no tiene Conector SANDBOX activo: se configura por los servicios F1 productivos.
  if (!await prisma.conectorPago.findFirst({ where: { entorno: "SANDBOX", estado: "ACTIVO", is_active: true, deleted_at: null } })) {
    const conectores = await import("../integraciones/conector-pago.service.ts");
    const conector = await conectores.crearConector({
      nombre: "Conector T17 SANDBOX",
      entorno: "SANDBOX",
      access_token: `TEST-T17-${randomUUID()}`,
      public_key: `TEST-T17-PK-${randomUUID()}`,
      webhook_secret: `t17-${randomUUID()}`,
    }, admin.id);
    await conectores.ejecutarHealthCheck(conector.conector_id);
  }
  const plazoDias = Number((await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_PLAZO_RETIRO_DIAS" } })).valor);

  /** Ejecuta el mantenimiento por el Route Handler real del cron (T12). */
  async function cron() {
    const headers: Record<string, string> = process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {};
    const respuesta = await cronRoute.POST(new NextRequest("http://t17.local/api/cron/check-pruebas-vencidas", { method: "POST", headers }));
    assert.equal(respuesta.status, 200);
    const body = await respuesta.json();
    await f.drenarListeners();
    assert.equal(body.mantenimiento_hu_e13.recordatorios.ok, true);
    assert.equal(body.mantenimiento_hu_e13.vencimientos.ok, true);
    assert.equal(body.mantenimiento_hu_e13.retries.ok, true);
    return body.mantenimiento_hu_e13 as {
      recordatorios: { procesados: number; errores: { pedido_venta_id: string; codigo: string }[] };
      vencimientos: { procesados: number; vencidos: number; errores: { pedido_venta_id: string; codigo: string }[] };
      retries: { procesados: number; refunds_reintentados: number; errores: { pedido_venta_id: string; codigo: string }[] };
    };
  }

  async function retriesT12(ahora: Date) {
    const resultado = await mantenimiento.procesarRetriesRefundHuE13(ahora);
    await f.drenarListeners();
    return resultado;
  }

  async function filaAdmin(pedidoVentaId: string) {
    for (let page = 1; ; page++) {
      const pagina = await adminPagados.listarPedidosPagadosAdmin({ page, page_size: 100 });
      const fila = pagina.items.find((item) => item.pedido_venta_id === pedidoVentaId);
      if (fila) return fila;
      if (page * pagina.page_size >= pagina.total) return null;
    }
  }

  async function enCola(pedidoVentaId: string) {
    for (let page = 1; ; page++) {
      const cola = await pickPack.listarColaPreparacion({ page, page_size: 50 });
      const item = cola.items.find((i) => i.pedido_venta_id === pedidoVentaId);
      if (item) return item;
      if (page * cola.page_size >= cola.total) return null;
    }
  }

  async function compra(lineas?: { cantidad: number }[]) {
    const c = await f.crearCompraPagada({ lineas });
    mp.registrarPago(c.payment_id, c.total);
    await f.drenarListeners();
    return c;
  }

  async function sagaDe(pedidoVentaId: string) {
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pedidoVentaId } });
    const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: saga.id }, orderBy: { numero: "asc" } });
    return { saga, intentos };
  }

  async function auditoriasHuE13(registroIds: string[]) {
    return prisma.auditLog.findMany({
      where: {
        registro_id: { in: registroIds },
        accion: { in: ["PEDIDO_PAGADO_CANCELADO", "PEDIDO_VENCIDO_SIN_RETIRO", "PLAZO_RETIRO_POR_VENCER", "REINTEGRO_APROBADO", "REINTEGRO_RECHAZADO", "REINTEGRO_REINTENTO_MANUAL"] },
      },
      orderBy: { created_at: "asc" },
    });
  }

  async function verificarSinSecretosPersistidos(c: Awaited<ReturnType<typeof compra>>, extras: string[] = []) {
    const { saga, intentos } = await sagaDe(c.pedido_venta_id);
    const auditorias = (await auditoriasHuE13([saga.id, ...intentos.map((i) => i.id)]))
      .map((a) => [a.valor_anterior, a.valor_nuevo]);
    const notificaciones = await prisma.notificacion.findMany({
      where: { cuenta_cliente_web_destinatario_id: c.cuenta.cuentaId, tipo_evento: { in: [...f.EVENTOS_F3_HU_E13] } },
      select: { asunto: true, cuerpo: true },
    });
    f.assertSinSecretos(JSON.stringify({ auditorias, notificaciones }), c, [
      ...intentos.flatMap((i) => [i.clave_idempotencia, i.refund_id ?? ""]),
      ...extras,
    ]);
  }

  async function sinNotificacionAdmin(tipo: string, claveOrigen: string) {
    assert.equal(await prisma.notificacion.count({
      where: { clave_idempotencia: { in: administradores.map((id) => f.claveF3(tipo, claveOrigen, id)) } },
    }), 0, `F3 HU-E13 no se dirige a ADMINISTRADOR_ECOMMERCE (${tipo})`);
  }

  async function vencerPorCron(c: Awaited<ReturnType<typeof compra>>) {
    await f.avanzarRelojPlazo(c.pedido_venta_id, new Date(Date.now() - 60_000));
    const resultado = await cron();
    assert.ok(!resultado.vencimientos.errores.some((e) => e.pedido_venta_id === c.pedido_venta_id));
    return resultado;
  }

  // Pedido multi-ítem que atraviesa toda la máquina hasta el vencimiento.
  let multi!: Awaited<ReturnType<typeof compra>>;
  const completados: Awaited<ReturnType<typeof compra>>[] = [];

  await t.test("E2: pago aprobado persiste PAGO_CONFIRMADO en cola sin operador; la toma es la única transición", async () => {
    multi = await compra([{ cantidad: 2 }, { cantidad: 1 }]);
    const pid = multi.pedido_venta_id;
    const venta = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pid } });
    const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
    assert.equal(venta.estado, "FACTURADO");
    assert.equal(ext.estado_ecommerce, "PAGO_CONFIRMADO");
    assert.equal(ext.operador_asignado_id, null);
    assert.equal(ext.codigo_qr_retiro, null);
    assert.equal(ext.mercadopago_payment_id, multi.payment_id);
    assert.ok(ext.fecha_pago_confirmado);
    const log = await prisma.transaccionPagoLog.findMany({ where: { pedido_venta_ecommerce_id: ext.id } });
    assert.equal(log.length, 1);
    assert.equal(log[0]!.estado_pago, "APROBADO");
    assert.ok(log[0]!.monto.equals(multi.total));
    const facturas = await prisma.comprobanteFiscal.findMany({ where: { pedido_venta_id: pid } });
    assert.equal(facturas.length, 1);
    assert.notEqual(facturas[0]!.tipo_comprobante, "NOTA_CREDITO");
    assert.ok(facturas[0]!.monto_total.equals(multi.total));
    assert.equal(await prisma.ventaMedioPago.count({ where: { pedido_venta_id: pid, medio: "MERCADO_PAGO", referencia: multi.payment_id } }), 1);
    const egresos = await prisma.movimientoStock.findMany({
      where: { venta_id: pid, tipo_movimiento: "EGRESO", comprobante_referencia: { startsWith: "RESERVA-CONFIRMADA-" } },
      include: { items: true },
    });
    assert.equal(egresos.length, 2);
    assert.ok(egresos.every((m) => m.items.every((i) => i.estado_origen === "RESERVADO" && i.estado_destino === "VENDIDO")));
    for (const articulo of multi.articulos) {
      assert.equal(await f.stockDisponible(articulo.variante_sku_id, multi.deposito_id), 10 - articulo.cantidad);
    }
    const cola = await enCola(pid);
    assert.equal(cola?.estado_ecommerce, "PAGO_CONFIRMADO");
    assert.equal(cola?.operador_asignado_id, null);
    assert.equal(await prisma.notificacion.count({
      where: { clave_idempotencia: f.claveF3("ecommerce:pedido_admitido_cola", `${ext.id}:PAGO_CONFIRMADO`, operador.id) },
    }), 1);
    const leido = await filaAdmin(pid);
    assert.deepEqual(leido?.acciones, { cancelar_pedido: true, reintentar_reintegro: false });
    assert.equal(leido?.reintegro, null);

    // Webhook repetido: sin duplicar efectos y sin admisión automática a EN_PREPARACION.
    const antes = await f.efectos(multi);
    await f.notificarPagoAprobado(multi);
    await f.drenarListeners();
    assert.deepEqual(await f.efectos(multi), antes);
    assert.equal(await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: pid } }), 1);
    assert.equal(await prisma.ingresoTesoreria.count({ where: { pedido_venta_id: pid } }), 1);
    const despues = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
    assert.equal(despues.estado_ecommerce, "PAGO_CONFIRMADO");
    assert.equal(despues.operador_asignado_id, null);

    const tomado = await pickPack.tomarPedido(pid, operador.id);
    assert.equal(tomado.cambio_realizado, true);
    const enPreparacion = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
    assert.equal(enPreparacion.estado_ecommerce, "EN_PREPARACION");
    assert.equal(enPreparacion.operador_asignado_id, operador.id);
    assert.equal((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pid } })).estado, "FACTURADO");
    assert.equal((await pickPack.tomarPedido(pid, operador.id)).cambio_realizado, false);
    assert.equal((await enCola(pid))?.estado_ecommerce, "EN_PREPARACION");
    assert.equal((await filaAdmin(pid))?.acciones.cancelar_pedido, true);
    await f.drenarListeners();
  });

  await t.test("E12: scans y completar reales → LISTO con QR y plazo; nunca se salta desde PAGO_CONFIRMADO", async () => {
    const sinTomar = await compra();
    const sku = sinTomar.articulos[0]!.sku;
    await assert.rejects(() => pickPack.confirmarItem(sinTomar.pedido_venta_id, operador.id, { scan_id: randomUUID(), codigo: sku }),
      (error: unknown) => error instanceof ServiceError);
    await assert.rejects(() => pickPack.completarPreparacion(sinTomar.pedido_venta_id, operador.id),
      (error: unknown) => error instanceof ServiceError);
    const intacto = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: sinTomar.pedido_venta_id } });
    assert.equal(intacto.estado_ecommerce, "PAGO_CONFIRMADO");
    assert.equal(intacto.codigo_qr_retiro, null);
    assert.equal(await prisma.pedidoPreparacionEscaneo.count({ where: { pedido_venta_item: { pedido_venta_id: sinTomar.pedido_venta_id } } }), 0);

    const pid = multi.pedido_venta_id;
    await assert.rejects(() => pickPack.completarPreparacion(pid, operador.id),
      (error: unknown) => error instanceof ServiceError && error.code === "PREPARACION_INCOMPLETA");
    await f.escanearTodo(pid, operador.id);
    const antesDeCompletar = Date.now();
    const completado = await pickPack.completarPreparacion(pid, operador.id);
    assert.equal(completado.estado_ecommerce, "LISTO_PARA_RETIRO");
    const listo = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
    assert.equal(listo.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.ok(listo.codigo_qr_retiro);
    const esperado = antesDeCompletar + plazoDias * 86_400_000;
    assert.ok(Math.abs(listo.plazo_retiro_vencimiento!.getTime() - esperado) < 120_000, "plazo = LISTO + ECOMMERCE_PLAZO_RETIRO_DIAS");
    assert.equal((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pid } })).estado, "FACTURADO");
    await f.drenarListeners();
    assert.equal(await prisma.notificacion.count({
      where: { tipo_evento: "ecommerce:pedido_listo_para_retiro", cuenta_cliente_web_destinatario_id: multi.cuenta.cuentaId },
    }), 1);
    const detalle = await misPedidos.obtenerPedidoWebCliente(multi.cuenta.clienteId, pid);
    assert.equal(detalle.estado, "LISTO_PARA_RETIRO");
    assert.ok(detalle.qr_data_url, "QR visible para el dueño mientras está LISTO");
    assert.equal((await enCola(pid)), null, "LISTO sale de la cola de preparación");
    assert.equal((await filaAdmin(pid))?.acciones.cancelar_pedido, true);
  });

  await t.test("T12 recordatorio: LISTO dentro de ventana no vence, sin saga/refund, una notificación y auditoría idempotente", async () => {
    const c = await compra();
    await f.prepararHastaListo(c.pedido_venta_id, operador.id);
    await f.drenarListeners();
    const plazo = new Date(Date.now() + 12 * 3_600_000);
    await f.avanzarRelojPlazo(c.pedido_venta_id, plazo);
    const qr = (await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } })).codigo_qr_retiro!;
    await cron();
    await cron();
    const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
    assert.equal(ext.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.equal(ext.is_active, true);
    assert.equal(ext.codigo_qr_retiro, qr);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: c.pedido_venta_id } }), 0);
    assert.equal(mp.llamadasDe(c.payment_id).length, 0);
    const claveOrigen = `${c.pedido_venta_id}:${plazo.toISOString()}`;
    const notificaciones = await prisma.notificacion.findMany({
      where: { tipo_evento: "ecommerce:plazo_retiro_por_vencer", cuenta_cliente_web_destinatario_id: c.cuenta.cuentaId },
    });
    assert.equal(notificaciones.length, 1);
    assert.equal(notificaciones[0]!.clave_idempotencia, f.claveF3("ecommerce:plazo_retiro_por_vencer", claveOrigen, c.cuenta.cuentaId));
    assert.equal(notificaciones[0]!.prioridad, "ADVERTENCIA");
    await sinNotificacionAdmin("ecommerce:plazo_retiro_por_vencer", claveOrigen);
    const auditorias = await auditoriasHuE13([claveOrigen]);
    assert.equal(auditorias.length, 1);
    assert.equal(auditorias[0]!.accion, "PLAZO_RETIRO_POR_VENCER");
    assert.equal(auditorias[0]!.usuario_id, null);
    f.assertSinSecretos(JSON.stringify({
      auditorias: auditorias.map((a) => [a.valor_anterior, a.valor_nuevo]),
      notificaciones: notificaciones.map((n) => [n.asunto, n.cuerpo]),
    }), c, [qr]);
  });

  await t.test("T12 vencimiento multi-ítem → VENCIDO_SIN_RETIRO, saga completa y refund APROBADO", async () => {
    const pid = multi.pedido_venta_id;
    const fiscal = await f.snapshotFiscal(pid);
    const qr = (await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } })).codigo_qr_retiro!;
    mp.guionar(multi.payment_id, "approved");
    await vencerPorCron(multi);
    await f.verificarTerminalCompensado(multi, fiscal, "VENCIDO_SIN_RETIRO");
    const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
    assert.equal(ext.deletion_reason, "Plazo de retiro vencido");
    assert.equal(ext.deleted_by, canalWeb.id);
    assert.equal(ext.operador_asignado_id, operador.id, "el operador histórico se conserva");
    const { saga, intentos } = await sagaDe(pid);
    assert.equal(saga.solicitado_por_tipo, "SISTEMA");
    assert.equal(saga.solicitado_por_id, null);
    assert.equal(saga.motivo, "Plazo de retiro vencido");
    assert.equal(saga.estado, "APROBADO");
    assert.equal(saga.proximo_reintento_at, null);
    assert.ok(saga.resuelto_at);
    assert.equal(intentos.length, 1);
    const [intento] = intentos;
    assert.equal(saga.intento_aprobado_id, intento!.id);
    assert.equal(intento!.origen, "INICIAL");
    assert.equal(intento!.numero, 1);
    assert.equal(intento!.estado, "APROBADO");
    assert.equal(intento!.clave_idempotencia, `HU-E13:REFUND:${pid}:${multi.payment_id}:1`);
    assert.equal(intento!.intentos_tecnicos, 0);
    assert.ok(intento!.refund_id?.startsWith("T17-REF-"));
    const llamadas = mp.llamadasDe(multi.payment_id);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0]!.url, `https://api.mercadopago.com/v1/payments/${multi.payment_id}/refunds`);
    assert.equal(llamadas[0]!.method, "POST");
    assert.equal(llamadas[0]!.body, undefined, "refund total: sin body parcial");
    assert.equal(llamadas[0]!.idempotency_key, intento!.clave_idempotencia);
    assert.equal(llamadas[0]!.authorization_presente, true);

    const auditorias = await auditoriasHuE13([saga.id, intento!.id]);
    assert.deepEqual(auditorias.map((a) => [a.accion, a.usuario_id]), [
      ["PEDIDO_VENCIDO_SIN_RETIRO", null],
      ["REINTEGRO_APROBADO", null],
    ]);
    const e = await f.efectos(multi);
    assert.equal(e.notificaciones_e13, 1, "F3 una vez a la cuenta Cliente Web");
    await sinNotificacionAdmin("ecommerce:pedido_vencido_sin_retiro", saga.id);
    await verificarSinSecretosPersistidos(multi, [qr]);

    const listado = await misPedidos.listarPedidosWebCliente(multi.cuenta.clienteId);
    assert.equal(listado.pedidos.find((p) => p.id === pid)?.estado, "VENCIDO_SIN_RETIRO");
    const detalle = await misPedidos.obtenerPedidoWebCliente(multi.cuenta.clienteId, pid);
    assert.equal(detalle.estado, "VENCIDO_SIN_RETIRO");
    assert.equal(detalle.qr_data_url, null);
    f.assertSinSecretos(JSON.stringify({ listado, detalle }), multi, [qr, saga.id, intento!.id]);
    // Post-T17 (SPEC §2.13.16): E9 completo y F3 de vencimiento CRITICA, solo al Cliente Web.
    await f.verificarE9Terminal(detalle as unknown as Record<string, unknown>, multi, {
      estado: "VENCIDO_SIN_RETIRO", motivo: "Plazo de retiro vencido", reintegro_estado: "APROBADO",
    });
    const avisoVencido = await prisma.notificacion.findUniqueOrThrow({
      where: { clave_idempotencia: f.claveF3("ecommerce:pedido_vencido_sin_retiro", saga.id, multi.cuenta.cuentaId) },
    });
    assert.equal(avisoVencido.prioridad, "CRITICA");
    assert.equal(avisoVencido.usuario_destinatario_id, null);
    const otro = await f.crearCuenta();
    await assert.rejects(() => misPedidos.obtenerPedidoWebCliente(otro.clienteId, pid),
      (error: unknown) => error instanceof ServiceError && error.code === "PEDIDO_NO_ENCONTRADO");
    assert.equal((await misPedidos.listarPedidosWebCliente(otro.clienteId)).total, 0);

    assert.deepEqual(await filaAdmin(pid), {
      pedido_venta_id: pid,
      numero: multi.numero_venta,
      fecha: (await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pid } })).created_at.toISOString(),
      total: multi.total.toFixed(2),
      estado_ecommerce: "VENCIDO_SIN_RETIRO",
      plazo_retiro_vencimiento: ext.plazo_retiro_vencimiento!.toISOString(),
      reintegro: { estado: "APROBADO", tiene_intento_pendiente: false },
      acciones: { cancelar_pedido: false, reintentar_reintegro: false },
    });
    assert.equal(await enCola(pid), null);

    const antes = await f.efectos(multi);
    await cron();
    assert.deepEqual(await f.efectos(multi), antes, "segunda pasada del cron es no-op");
    assert.equal(mp.llamadasDe(multi.payment_id).length, 1);
    completados.push(multi);
  });

  await t.test("refund técnico (timeout, 5xx, 429, red, ambigua) multi-depósito: T12 reutiliza fila, número y key con backoff T08", async () => {
    const config = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_DEPOSITO_CANAL_WEB_ID" } });
    let c!: Awaited<ReturnType<typeof compra>>;
    await prisma.configuracionSistema.update({ where: { clave: config.clave }, data: { valor: f.DEPOSITO_CENTRAL_ID } });
    try {
      c = await compra();
    } finally {
      await prisma.configuracionSistema.update({ where: { clave: config.clave }, data: { valor: config.valor } });
    }
    assert.equal(c.deposito_id, f.DEPOSITO_CENTRAL_ID);
    await f.prepararHastaListo(c.pedido_venta_id, operador.id);
    await f.drenarListeners();
    const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
    mp.guionar(c.payment_id, "timeout");
    await vencerPorCron(c);
    await f.verificarTerminalCompensado(c, fiscal, "VENCIDO_SIN_RETIRO");
    let { saga, intentos } = await sagaDe(c.pedido_venta_id);
    const original = intentos[0]!;
    assert.equal(intentos.length, 1);
    assert.equal(original.estado, "PENDIENTE");
    assert.equal(original.intentos_tecnicos, 1);
    assert.equal(original.error_codigo, "MP_TIMEOUT");
    assert.equal(saga.estado, "PENDIENTE");
    assert.equal(saga.ultimo_error_codigo, "MP_TIMEOUT");
    assert.equal(saga.proximo_reintento_at!.getTime(), original.ultimo_intento_at!.getTime() + 5 * 60_000);
    assert.deepEqual((await filaAdmin(c.pedido_venta_id))?.reintegro, { estado: "PENDIENTE", tiene_intento_pendiente: true });
    assert.equal((await filaAdmin(c.pedido_venta_id))?.acciones.reintentar_reintegro, false);

    await retriesT12(new Date(saga.proximo_reintento_at!.getTime() - 1_000));
    assert.equal(mp.llamadasDe(c.payment_id).length, 1, "antes de proximo_reintento_at no hay retry");

    const pasos: [import("./hu-e13.test-fixtures.ts").GuionRefund, string, number][] = [
      ["http_500", "MP_HTTP_5XX", 10],
      ["http_429", "MP_HTTP_429", 20],
      ["red", "MP_RED", 40],
      ["ambigua", "MP_RESPUESTA_AMBIGUA", 80],
    ];
    for (const [guion, codigo, delay] of pasos) {
      mp.guionar(c.payment_id, guion);
      await retriesT12(new Date(saga.proximo_reintento_at!.getTime() + 1_000));
      ({ saga, intentos } = await sagaDe(c.pedido_venta_id));
      assert.equal(intentos.length, 1, `${guion}: nunca crea un intento nuevo`);
      const actual = intentos[0]!;
      assert.equal(actual.id, original.id);
      assert.equal(actual.numero, 1);
      assert.equal(actual.clave_idempotencia, original.clave_idempotencia);
      assert.equal(actual.estado, "PENDIENTE");
      assert.equal(actual.error_codigo, codigo);
      assert.equal(saga.estado, "PENDIENTE");
      assert.equal(saga.proximo_reintento_at!.getTime(), actual.ultimo_intento_at!.getTime() + delay * 60_000);
    }
    assert.equal(intentos[0]!.intentos_tecnicos, 5);

    mp.guionar(c.payment_id, "approved");
    await retriesT12(new Date(saga.proximo_reintento_at!.getTime() + 1_000));
    ({ saga, intentos } = await sagaDe(c.pedido_venta_id));
    assert.equal(intentos.length, 1);
    assert.equal(intentos[0]!.id, original.id);
    assert.equal(intentos[0]!.estado, "APROBADO");
    assert.equal(intentos[0]!.intentos_tecnicos, 5);
    assert.equal(saga.estado, "APROBADO");
    assert.equal(saga.intento_aprobado_id, original.id);
    assert.equal(saga.proximo_reintento_at, null);
    const llamadas = mp.llamadasDe(c.payment_id);
    assert.equal(llamadas.length, 6);
    assert.ok(llamadas.every((l) => l.idempotency_key === original.clave_idempotencia));
    const auditorias = await auditoriasHuE13([original.id]);
    assert.deepEqual(auditorias.map((a) => a.accion), ["REINTEGRO_APROBADO"], "fallas técnicas no auditan rechazo");
    await f.verificarTerminalCompensado(c, fiscal, "VENCIDO_SIN_RETIRO");
    await verificarSinSecretosPersistidos(c);
    completados.push(c);
  });

  await t.test("PENDING remoto: sin intentos técnicos, +15 min y T12 reutiliza el mismo intento/key", async () => {
    const c = await compra();
    await f.prepararHastaListo(c.pedido_venta_id, operador.id);
    await f.drenarListeners();
    mp.guionar(c.payment_id, "pending");
    await vencerPorCron(c);
    let { saga, intentos } = await sagaDe(c.pedido_venta_id);
    const intento = intentos[0]!;
    assert.equal(intentos.length, 1);
    assert.equal(intento.estado, "PENDIENTE");
    assert.equal(intento.intentos_tecnicos, 0);
    assert.equal(intento.error_codigo, null);
    assert.ok(intento.refund_id);
    assert.equal(saga.estado, "PENDIENTE");
    assert.equal(saga.ultimo_error_codigo, null);
    assert.equal(saga.proximo_reintento_at!.getTime(), intento.ultimo_intento_at!.getTime() + 15 * 60_000);
    await retriesT12(new Date(saga.proximo_reintento_at!.getTime() - 1_000));
    assert.equal(mp.llamadasDe(c.payment_id).length, 1);
    mp.guionar(c.payment_id, "approved");
    await retriesT12(new Date(saga.proximo_reintento_at!.getTime() + 1_000));
    ({ saga, intentos } = await sagaDe(c.pedido_venta_id));
    assert.equal(intentos.length, 1);
    assert.equal(intentos[0]!.id, intento.id);
    assert.equal(intentos[0]!.clave_idempotencia, intento.clave_idempotencia);
    assert.equal(intentos[0]!.refund_id, intento.refund_id, "el mismo refund remoto progresa a aprobado");
    assert.equal(intentos[0]!.estado, "APROBADO");
    assert.equal(intentos[0]!.intentos_tecnicos, 0);
    assert.equal(saga.estado, "APROBADO");
    assert.ok(mp.llamadasDe(c.payment_id).every((l) => l.idempotency_key === intento.clave_idempotencia));
    completados.push(c);
  });

  await t.test("rechazo definitivo (remoto y HTTP 400): sin retry automático; T15 habilita el reintento manual", async () => {
    for (const guion of ["rejected", "http_400"] as const) {
      const c = await compra();
      await f.prepararHastaListo(c.pedido_venta_id, operador.id);
      await f.drenarListeners();
      const fiscal = await f.snapshotFiscal(c.pedido_venta_id);
      mp.guionar(c.payment_id, guion);
      await vencerPorCron(c);
      await f.verificarTerminalCompensado(c, fiscal, "VENCIDO_SIN_RETIRO");
      const { saga, intentos } = await sagaDe(c.pedido_venta_id);
      assert.equal(intentos.length, 1);
      assert.equal(intentos[0]!.estado, "RECHAZADO");
      assert.ok(intentos[0]!.error_codigo);
      assert.equal(saga.estado, "RECHAZADO");
      assert.equal(saga.proximo_reintento_at, null);
      assert.equal(saga.intento_aprobado_id, null);
      assert.ok(saga.resuelto_at);
      await cron();
      await retriesT12(new Date(Date.now() + 365 * 86_400_000));
      assert.equal(mp.llamadasDe(c.payment_id).length, 1, `${guion}: RECHAZADO nunca entra al retry automático`);
      assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: saga.id } }), 1);
      const auditorias = await auditoriasHuE13([intentos[0]!.id]);
      assert.deepEqual(auditorias.map((a) => [a.accion, a.usuario_id]), [["REINTEGRO_RECHAZADO", null]]);
      const fila = await filaAdmin(c.pedido_venta_id);
      assert.deepEqual(fila?.reintegro, { estado: "RECHAZADO", tiene_intento_pendiente: false });
      assert.deepEqual(fila?.acciones, { cancelar_pedido: false, reintentar_reintegro: true });
      assert.equal((await misPedidos.obtenerPedidoWebCliente(c.cuenta.clienteId, c.pedido_venta_id)).estado, "VENCIDO_SIN_RETIRO");
      await verificarSinSecretosPersistidos(c);
      completados.push(c);
    }
  });

  await t.test("legacy sin TransaccionPagoLog con evidencia durable completa: vencimiento permitido sin reescribir historia", async () => {
    const legacy = await f.crearPedidoLegacy({
      estado: "LISTO_PARA_RETIRO",
      plazo: new Date(Date.now() - 60_000),
      operadorId: operador.id,
    });
    mp.registrarPago(legacy.payment_id, legacy.total);
    const fiscal = await f.snapshotFiscal(legacy.pedido_venta_id);
    const evidencia = async () => ({
      medios: await prisma.ventaMedioPago.findMany({ where: { pedido_venta_id: legacy.pedido_venta_id } }),
      egresos: await prisma.movimientoStock.findMany({
        where: { venta_id: legacy.pedido_venta_id, tipo_movimiento: "EGRESO" },
        include: { items: true },
      }),
      ingreso: await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { pedido_venta_id: legacy.pedido_venta_id } }),
      reservas: await prisma.reserva.findMany({ where: { pedido_venta_item: { is: { pedido_venta_id: legacy.pedido_venta_id } } } }),
    });
    const antes = await evidencia();
    const resultado = await cron();
    assert.ok(!resultado.vencimientos.errores.some((e) => e.pedido_venta_id === legacy.pedido_venta_id));
    await f.verificarTerminalCompensado(legacy, fiscal, "VENCIDO_SIN_RETIRO");
    assert.deepEqual(await evidencia(), antes, "la evidencia histórica no se modifica");
    assert.equal((await f.efectos(legacy)).transacciones_pago, 0, "no se crea TransaccionPagoLog retroactivo");
    const { saga } = await sagaDe(legacy.pedido_venta_id);
    assert.equal(saga.estado, "APROBADO");
    completados.push(legacy);
  });

  await t.test("evidencia de pago contradictoria: T07 rechaza sin fallback ni efecto alguno", async () => {
    const contradictorio = await f.crearPedidoLegacy({
      estado: "LISTO_PARA_RETIRO",
      plazo: new Date(Date.now() - 60_000),
      operadorId: operador.id,
      contradictorio: true,
    });
    mp.registrarPago(contradictorio.payment_id, contradictorio.total);
    const extAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: contradictorio.pedido_venta_id } });
    const fiscal = await f.snapshotFiscal(contradictorio.pedido_venta_id);
    const auditAntes = await prisma.auditLog.count();
    const resultado = await cron();
    assert.ok(resultado.vencimientos.errores.some((e) =>
      e.pedido_venta_id === contradictorio.pedido_venta_id && e.codigo === "EVIDENCIA_PAGO_INCONSISTENTE"));
    assert.deepEqual(await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: contradictorio.pedido_venta_id } }), extAntes);
    assert.deepEqual(await f.snapshotFiscal(contradictorio.pedido_venta_id), fiscal);
    const e = await f.efectos(contradictorio);
    assert.deepEqual(
      [e.sagas, e.notas_credito, e.compensaciones, e.movimientos_compensacion, e.contra_asientos, e.intentos],
      [0, 0, 0, 0, 0, 0],
    );
    assert.equal(await f.stockDisponible(contradictorio.articulos[0]!.variante_sku_id, contradictorio.deposito_id), 9);
    assert.equal(mp.llamadasDe(contradictorio.payment_id).length, 0);
    assert.equal(await prisma.auditLog.count({
      where: { created_at: { gte: inicioSuite }, accion: "PEDIDO_VENCIDO_SIN_RETIRO", valor_nuevo: { path: ["pedido_venta_id"], equals: contradictorio.pedido_venta_id } },
    }), 0);
    assert.ok(await prisma.auditLog.count() >= auditAntes);
  });

  await t.test("E3: retiro válido sigue entregando y queda fuera de vencimiento, cola y lectura T15", async () => {
    const c = await compra();
    await f.prepararHastaListo(c.pedido_venta_id, operador.id);
    await f.drenarListeners();
    const qr = (await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } })).codigo_qr_retiro!;
    await retiro.validarYEntregarRetiro({ qr_token: qr, dni: c.dni }, operador.id);
    await f.drenarListeners();
    const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
    assert.equal(ext.estado_ecommerce, "ENTREGADO");
    assert.equal((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: c.pedido_venta_id } })).estado, "CERRADO");
    await cron();
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: c.pedido_venta_id } }), 0);
    assert.equal(await filaAdmin(c.pedido_venta_id), null, "ENTREGADO no pertenece a la lectura HU-E13");
    assert.equal(await enCola(c.pedido_venta_id), null);
    assert.equal(mp.llamadasDe(c.payment_id).length, 0);
  });

  await t.test("idempotencia global, invariantes y cadena AuditLog SHA-256 íntegra", async () => {
    const antes = await Promise.all(completados.map((c) => f.efectos(c)));
    const llamadasAntes = mp.llamadas.length;
    await cron();
    await cron();
    await mantenimiento.procesarVencimientosRetiroHuE13(new Date());
    await retriesT12(new Date());
    await f.drenarListeners();
    assert.deepEqual(await Promise.all(completados.map((c) => f.efectos(c))), antes);
    assert.equal(mp.llamadas.length, llamadasAntes, "ninguna llamada F1 adicional");
    for (const [i, c] of completados.entries()) {
      const e = antes[i]!;
      assert.equal(e.sagas, 1);
      assert.equal(e.notas_credito, 1);
      assert.equal(e.contra_asientos, 1);
      assert.equal(e.intentos_iniciales, 1);
      assert.ok(e.intentos_aprobados <= 1);
      assert.equal(e.notificaciones_e13, 1);
      assert.equal(e.auditorias_terminales, 1);
      assert.equal(e.movimientos_compensacion, c.articulos.length);
      const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: c.pedido_venta_id } });
      assert.equal(ext.estado_ecommerce, "VENCIDO_SIN_RETIRO", "un terminal nunca vuelve a estado operativo");
      const venta = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: c.pedido_venta_id } });
      assert.equal(venta.estado, "FACTURADO");
      assert.equal(venta.is_active, true);
      assert.equal(venta.cliente_id, c.cuenta.clienteId);
    }
    assert.equal(await prisma.notificacion.count({
      where: { created_at: { gte: inicioSuite }, tipo_evento: { in: [...f.EVENTOS_F3_HU_E13] }, usuario_destinatario_id: { not: null } },
    }), 0, "F3 HU-E13 solo al Cliente Web");
    const cadena = await auditoria.verificarCadenaIntegridad();
    assert.equal(cadena.integra, true, JSON.stringify(cadena));
  });
});
