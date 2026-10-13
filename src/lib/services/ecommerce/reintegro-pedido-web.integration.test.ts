import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T07_INTEGRATION_DATABASE_URL;
const DEPOSITO_CENTRAL_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
const SKU_A_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";
const SKU_B_ID = "864c2765-cbdd-41eb-837a-e12814b62868";

test("HU-E13 T07 — inicio durable y pasos locales", {
  skip: !DATABASE_URL,
  timeout: 180_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, servicio, pickPack, inventario, { ServiceError }, { domainEventBus }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./reintegro-pedido-web.service.ts"),
    import("./pick-pack.service.ts"),
    import("../inventario/compensacion-venta.service.ts"),
    import("../../errors/service-error.ts"),
    import("../../events/domain-event-bus.ts"),
  ]);
  t.after(() => prisma.$disconnect());

  const admin = await prisma.usuario.findFirstOrThrow({
    where: { is_active: true, deleted_at: null },
    select: { id: true },
  });
  const canalWeb = await prisma.usuario.findFirstOrThrow({
    where: { nombre_usuario: "canal.web.sistema", is_active: true, deleted_at: null },
    select: { id: true },
  });
  const cuentas = await prisma.cuentaClienteWeb.findMany({
    where: { is_active: true, deleted_at: null },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true, cliente_id: true },
  });
  const cuenta = cuentas[0]!;
  const otraCuenta = cuentas[1]!;
  assert.ok(cuenta && otraCuenta && cuenta.cliente_id !== otraCuenta.cliente_id);

  type Linea = { variante_sku_id: string; deposito_id: string; cantidad: number };
  type FixtureOptions = {
    estado?: "PAGO_CONFIRMADO" | "EN_PREPARACION" | "LISTO_PARA_RETIRO" | "ENTREGADO" | "CANCELADO" | "VENCIDO_SIN_RETIRO";
    deadline?: Date | null;
    conIngreso?: boolean;
    conLogAprobado?: boolean;
    logContradictorio?: boolean;
    conMedioPago?: boolean;
    lineas?: Linea[];
  };

  async function fixture(options: FixtureOptions = {}) {
    const lineas = options.lineas ?? [{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 2 }];
    const total = lineas.reduce((suma, linea) => suma + linea.cantidad * 100, 0);
    const paymentId = `t07-${randomUUID()}`;
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `T07-${randomUUID()}`,
        cliente_id: cuenta.cliente_id,
        canal: "WEB",
        estado: "FACTURADO",
        total,
        fecha_facturacion: new Date(),
        registrado_por_id: admin.id,
      },
    });
    const ecommerce = await prisma.pedidoVentaEcommerce.create({
      data: {
        pedido_venta_id: pedido.id,
        estado_ecommerce: options.estado ?? "PAGO_CONFIRMADO",
        mercadopago_payment_id: paymentId,
        fecha_pago_confirmado: new Date(),
        codigo_qr_retiro: options.estado === "LISTO_PARA_RETIRO" ? `QR-${randomUUID()}` : null,
        plazo_retiro_vencimiento: options.deadline === undefined
          ? (options.estado === "LISTO_PARA_RETIRO" ? new Date(Date.now() + 86_400_000) : null)
          : options.deadline,
      },
    });
    if (options.conLogAprobado !== false) {
      await prisma.transaccionPagoLog.create({
        data: {
          pedido_venta_ecommerce_id: ecommerce.id,
          mercadopago_payment_id: paymentId,
          monto: total,
          estado_pago: "APROBADO",
          resultado_webhook: "{}",
          datos_facturacion_cifrados: "fixture",
          datos_facturacion_iv: "fixture",
        },
      });
    }
    if (options.logContradictorio) {
      await prisma.transaccionPagoLog.create({
        data: {
          pedido_venta_ecommerce_id: ecommerce.id,
          mercadopago_payment_id: paymentId,
          monto: total,
          estado_pago: "RECHAZADO",
          resultado_webhook: "{}",
          datos_facturacion_cifrados: "fixture",
          datos_facturacion_iv: "fixture",
        },
      });
    }
    if (options.conMedioPago) {
      await prisma.ventaMedioPago.create({
        data: {
          pedido_venta_id: pedido.id,
          medio: "MERCADO_PAGO",
          importe: total,
          referencia: paymentId,
        },
      });
    }
    const factura = await prisma.comprobanteFiscal.create({
      data: {
        pedido_venta_id: pedido.id,
        tipo_comprobante: "FACTURA_B",
        cae_simulado: "12345678901234",
        qr_data_url: `data:image/png;base64,${randomUUID()}`,
        es_simulado: true,
        monto_total: total,
        emitido_por_id: admin.id,
      },
    });
    const items = [];
    for (const linea of lineas) {
      const reserva = await prisma.reserva.create({
        data: {
          variante_sku_id: linea.variante_sku_id,
          deposito_id: linea.deposito_id,
          cantidad: linea.cantidad,
          fecha_inicio_reserva: new Date(Date.now() - 86_400_000),
          fecha_fin_reserva: new Date(),
          fecha_expiracion: new Date(Date.now() + 86_400_000),
          motivo: "Venta pagada T07",
          origen_reserva: "CHECKOUT_WEB",
          registrado_por_id: admin.id,
        },
      });
      const item = await prisma.pedidoVentaItem.create({
        data: {
          pedido_venta_id: pedido.id,
          variante_sku_id: linea.variante_sku_id,
          cantidad: linea.cantidad,
          precio_unitario: 100,
          reserva_id: reserva.id,
          cantidad_facturada: linea.cantidad,
          cantidad_entregada: 0,
        },
      });
      await prisma.movimientoStock.create({
        data: {
          deposito_origen_id: linea.deposito_id,
          tipo_movimiento: "EGRESO",
          comprobante_referencia: `RESERVA-CONFIRMADA-${reserva.id}`,
          registrado_por_id: admin.id,
          venta_id: pedido.id,
          items: {
            create: {
              variante_sku_id: linea.variante_sku_id,
              cantidad: linea.cantidad,
              estado_origen: "RESERVADO",
              estado_destino: "VENDIDO",
            },
          },
        },
      });
      items.push({ ...linea, item, reserva });
    }
    const ingreso = options.conIngreso === false ? null : await prisma.ingresoTesoreria.create({
      data: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: paymentId,
        monto: total,
        fecha: new Date(),
        estado: "PENDIENTE_CONCILIACION",
        caja_virtual: "MERCADO_PAGO_CANAL_WEB",
      },
    });
    return { pedido, ecommerce, factura, items, ingreso, paymentId };
  }

  const clienteInput = (pedido_venta_id: string, motivo = "Cancelación solicitada por cliente") => ({
    pedido_venta_id,
    causa: "CANCELACION_CLIENTE" as const,
    cliente_web_cuenta_id: cuenta.id,
    motivo,
  });
  const adminInput = (pedido_venta_id: string, motivo = "Cancelación administrativa") => ({
    pedido_venta_id,
    causa: "CANCELACION_ADMIN" as const,
    usuario_id: admin.id,
    motivo,
  });
  const venceInput = (pedido_venta_id: string) => ({ pedido_venta_id, causa: "VENCIMIENTO" as const });
  const rechazaCon = async (codigo: string, operacion: () => Promise<unknown>) => {
    await assert.rejects(operacion, (error: unknown) => error instanceof ServiceError && error.code === codigo);
  };

  await t.test("cancelación cliente completa Paso 0, NC, stock y G11 sin salir de PENDIENTE", async () => {
    const f = await fixture({
      lineas: [
        { variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 },
        { variante_sku_id: SKU_B_ID, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 2 },
      ],
    });
    const stockAntes = await Promise.all(f.items.map((linea) => prisma.stockDeposito.findUniqueOrThrow({
      where: { variante_sku_id_deposito_id: { variante_sku_id: linea.variante_sku_id, deposito_id: linea.deposito_id } },
      select: { cantidad: true },
    })));
    const refundAntes = await prisma.reintegroRefundIntento.count();
    let resolverEvento!: (valor: { reintegro_id: string; durable: boolean }) => void;
    const eventoPostCommit = new Promise<{ reintegro_id: string; durable: boolean }>((resolve) => {
      resolverEvento = resolve;
    });
    const alCancelar = (payload: { reintegro_id: string }) => {
      void prisma.reintegroPedidoWeb.findUnique({ where: { id: payload.reintegro_id }, select: { id: true } })
        .then((fila) => resolverEvento({ reintegro_id: payload.reintegro_id, durable: !!fila }));
    };
    domainEventBus.on("ecommerce:pedido_cancelado", alCancelar as never);
    const resultado = await servicio.iniciarYContinuarReintegroPedidoWeb(clienteInput(f.pedido.id));
    domainEventBus.off("ecommerce:pedido_cancelado", alCancelar as never);
    const evento = await eventoPostCommit;
    assert.equal(evento.reintegro_id, resultado.inicio.reintegro_id);
    assert.equal(evento.durable, true);
    assert.equal(resultado.inicio.resultado, "CREADO");
    assert.equal(resultado.pasos_locales.resultado, "PASOS_LOCALES_COMPLETOS");
    const [pedido, ecommerce, reintegro] = await Promise.all([
      prisma.pedidoVenta.findUniqueOrThrow({ where: { id: f.pedido.id } }),
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } }),
      prisma.reintegroPedidoWeb.findUniqueOrThrow({
        where: { id: resultado.inicio.reintegro_id },
        include: { compensaciones_stock: true },
      }),
    ]);
    assert.equal(pedido.estado, "FACTURADO");
    assert.equal(pedido.is_active, true);
    assert.equal(ecommerce.estado_ecommerce, "CANCELADO");
    assert.equal(ecommerce.is_active, false);
    assert.ok(ecommerce.deleted_at);
    assert.equal(ecommerce.deleted_by, canalWeb.id);
    assert.equal(ecommerce.codigo_qr_retiro, null);
    assert.equal(reintegro.estado, "PENDIENTE");
    assert.equal(reintegro.solicitado_por_tipo, "CLIENTE_WEB");
    assert.equal(reintegro.nota_credito_id, resultado.pasos_locales.nota_credito_id);
    assert.ok(reintegro.contra_asiento_ingreso_id);
    assert.equal(reintegro.compensaciones_stock.length, 2);
    assert.ok(reintegro.compensaciones_stock.every((linea) => linea.movimiento_stock_id && linea.completed_at));
    assert.equal((await prisma.comprobanteFiscal.findUniqueOrThrow({
      where: { id: resultado.pasos_locales.nota_credito_id },
      select: { emitido_por_id: true },
    })).emitido_por_id, canalWeb.id);
    assert.ok((await prisma.movimientoStock.findMany({
      where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } },
      select: { registrado_por_id: true },
    })).every((movimiento) => movimiento.registrado_por_id === canalWeb.id));
    for (let i = 0; i < f.items.length; i++) {
      const stock = await prisma.stockDeposito.findUniqueOrThrow({
        where: { variante_sku_id_deposito_id: { variante_sku_id: f.items[i]!.variante_sku_id, deposito_id: f.items[i]!.deposito_id } },
        select: { cantidad: true },
      });
      assert.equal(stock.cantidad, stockAntes[i]!.cantidad + f.items[i]!.cantidad);
    }
    assert.equal(await prisma.reintegroRefundIntento.count(), refundAntes);
  });

  await t.test("cancelación admin admite los tres estados aprobados", async () => {
    for (const estado of ["PAGO_CONFIRMADO", "EN_PREPARACION", "LISTO_PARA_RETIRO"] as const) {
      const f = await fixture({ estado });
      const resultado = await servicio.iniciarYContinuarReintegroPedidoWeb(adminInput(f.pedido.id, `Motivo ${estado}`));
      assert.equal(resultado.pasos_locales.resultado, "PASOS_LOCALES_COMPLETOS");
      const ecommerce = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
      const reintegro = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: resultado.inicio.reintegro_id } });
      assert.equal(ecommerce.estado_ecommerce, "CANCELADO");
      assert.equal(ecommerce.deleted_by, admin.id);
      assert.equal(reintegro.solicitado_por_tipo, "USUARIO");
      assert.equal(reintegro.solicitado_por_id, admin.id);
      assert.equal((await prisma.comprobanteFiscal.findUniqueOrThrow({
        where: { id: resultado.pasos_locales.nota_credito_id },
        select: { emitido_por_id: true },
      })).emitido_por_id, admin.id);
      assert.ok((await prisma.movimientoStock.findMany({
        where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } },
        select: { registrado_por_id: true },
      })).every((movimiento) => movimiento.registrado_por_id === admin.id));
    }
  });

  await t.test("vencimiento exige LISTO y deadline estrictamente vencido", async () => {
    const f = await fixture({ estado: "LISTO_PARA_RETIRO", deadline: new Date(Date.now() - 1_000) });
    const inicio = await servicio.iniciarReintegroPedidoWebPaso0(venceInput(f.pedido.id));
    const ecommerce = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    const reintegro = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: inicio.reintegro_id } });
    assert.equal(ecommerce.estado_ecommerce, "VENCIDO_SIN_RETIRO");
    assert.equal(ecommerce.codigo_qr_retiro, null);
    assert.equal(ecommerce.deletion_reason, servicio.MOTIVO_VENCIMIENTO_RETIRO);
    assert.equal(reintegro.solicitado_por_tipo, "SISTEMA");
    assert.equal(reintegro.solicitado_por_id, null);
    assert.equal(ecommerce.deleted_by, canalWeb.id);
    const continuacion = await servicio.continuarPasosLocalesReintegroPedidoWeb(inicio.reintegro_id);
    assert.equal((await prisma.comprobanteFiscal.findUniqueOrThrow({
      where: { id: continuacion.nota_credito_id },
      select: { emitido_por_id: true },
    })).emitido_por_id, canalWeb.id);
    assert.ok((await prisma.movimientoStock.findMany({
      where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } },
      select: { registrado_por_id: true },
    })).every((movimiento) => movimiento.registrado_por_id === canalWeb.id));
  });

  await t.test("fallback legacy admite EN_PREPARACION y LISTO sin log aprobado", async () => {
    for (const estado of ["EN_PREPARACION", "LISTO_PARA_RETIRO"] as const) {
      const f = await fixture({ estado, conLogAprobado: false, conMedioPago: true });
      const resultado = await servicio.iniciarYContinuarReintegroPedidoWeb(adminInput(f.pedido.id));
      assert.equal(resultado.pasos_locales.resultado, "PASOS_LOCALES_COMPLETOS");
      assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "CANCELADO");
      assert.equal(await prisma.transaccionPagoLog.count({ where: { pedido_venta_ecommerce_id: f.ecommerce.id } }), 0);
    }
  });

  await t.test("fallback legacy admite vencimiento LISTO sin log aprobado", async () => {
    const f = await fixture({
      estado: "LISTO_PARA_RETIRO",
      deadline: new Date(Date.now() - 1_000),
      conLogAprobado: false,
      conMedioPago: true,
    });
    const resultado = await servicio.iniciarYContinuarReintegroPedidoWeb(venceInput(f.pedido.id));
    assert.equal(resultado.pasos_locales.resultado, "PASOS_LOCALES_COMPLETOS");
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "VENCIDO_SIN_RETIRO");
    assert.equal(await prisma.transaccionPagoLog.count({ where: { pedido_venta_ecommerce_id: f.ecommerce.id } }), 0);
  });

  await t.test("fallback legacy rechaza evidencia incompleta sin producir efectos", async () => {
    const f = await fixture({ estado: "EN_PREPARACION", conLogAprobado: false, conMedioPago: false });
    const ecommerceAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    let eventos = 0;
    const alCancelar = () => { eventos++; };
    domainEventBus.on("ecommerce:pedido_cancelado", alCancelar);
    await rechazaCon("EVIDENCIA_PAGO_INCONSISTENTE", () => servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id)));
    domainEventBus.off("ecommerce:pedido_cancelado", alCancelar);
    assert.equal(eventos, 0);
    assert.deepEqual(await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } }), ecommerceAntes);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: f.pedido.id } }), 0);
    assert.equal(await prisma.reintegroStockCompensacion.count({ where: { pedido_venta_item_id: { in: f.items.map((item) => item.item.id) } } }), 0);
  });

  await t.test("un log contradictorio impide usar el fallback legacy", async () => {
    const f = await fixture({
      estado: "LISTO_PARA_RETIRO",
      conLogAprobado: false,
      logContradictorio: true,
      conMedioPago: true,
    });
    await rechazaCon("EVIDENCIA_PAGO_INCONSISTENTE", () => servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id)));
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: f.pedido.id } }), 0);
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "LISTO_PARA_RETIRO");
  });

  await t.test("cancelación cliente valida propiedad canónica y conserva la relación", async () => {
    const ajeno = await fixture();
    const ecommerceAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: ajeno.ecommerce.id } });
    await rechazaCon("PEDIDO_NO_ENCONTRADO", () => servicio.iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: ajeno.pedido.id,
      causa: "CANCELACION_CLIENTE",
      cliente_web_cuenta_id: otraCuenta.id,
      motivo: "Intento ajeno",
    }));
    assert.deepEqual(await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: ajeno.ecommerce.id } }), ecommerceAntes);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: ajeno.pedido.id } }), 0);

    const propio = await fixture();
    await servicio.iniciarReintegroPedidoWebPaso0(clienteInput(propio.pedido.id));
    const pedidoDespues = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: propio.pedido.id } });
    const ecommerceDespues = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: propio.ecommerce.id } });
    assert.equal(pedidoDespues.cliente_id, cuenta.cliente_id);
    assert.equal(ecommerceDespues.deleted_by, canalWeb.id);
    assert.notEqual(ecommerceDespues.deleted_by, cuenta.id);
  });

  await t.test("rechaza estados, plazo y motivo no permitidos sin crear saga", async () => {
    const clientePreparando = await fixture({ estado: "EN_PREPARACION" });
    await rechazaCon("TRANSICION_INVALIDA", () => servicio.iniciarReintegroPedidoWebPaso0(clienteInput(clientePreparando.pedido.id)));
    const adminEntregado = await fixture({ estado: "ENTREGADO" });
    await rechazaCon("TRANSICION_INVALIDA", () => servicio.iniciarReintegroPedidoWebPaso0(adminInput(adminEntregado.pedido.id)));
    const venceFuturo = await fixture({ estado: "LISTO_PARA_RETIRO", deadline: new Date(Date.now() + 60_000) });
    await rechazaCon("PLAZO_NO_VENCIDO", () => servicio.iniciarReintegroPedidoWebPaso0(venceInput(venceFuturo.pedido.id)));
    const vencePreparando = await fixture({ estado: "EN_PREPARACION" });
    await rechazaCon("TRANSICION_INVALIDA", () => servicio.iniciarReintegroPedidoWebPaso0(venceInput(vencePreparando.pedido.id)));
    const motivo = await fixture();
    await rechazaCon("MOTIVO_REQUERIDO", () => servicio.iniciarReintegroPedidoWebPaso0(clienteInput(motivo.pedido.id, "   ")));
    assert.equal(await prisma.reintegroPedidoWeb.count({
      where: { pedido_venta_id: { in: [clientePreparando.pedido.id, adminEntregado.pedido.id, venceFuturo.pedido.id, vencePreparando.pedido.id, motivo.pedido.id] } },
    }), 0);
  });

  await t.test("dos inicios concurrentes crean una cabecera y las hijas una sola vez", async () => {
    const f = await fixture({ lineas: [
      { variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 },
      { variante_sku_id: SKU_B_ID, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 1 },
    ] });
    const resultados = await Promise.all([
      servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id)),
      servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id)),
    ]);
    assert.deepEqual(resultados.map((r) => r.resultado).sort(), ["CREADO", "REUTILIZADO"]);
    assert.equal(new Set(resultados.map((r) => r.reintegro_id)).size, 1);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: f.pedido.id } }), 1);
    assert.equal(await prisma.reintegroStockCompensacion.count({ where: { reintegro_id: resultados[0]!.reintegro_id } }), 2);
  });

  await t.test("retry completo no duplica NC, stock ni contra-asiento y preserva historia", async () => {
    const f = await fixture();
    const primero = await servicio.iniciarYContinuarReintegroPedidoWeb(adminInput(f.pedido.id, "Motivo original"));
    const extensionAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    const reintegroAntes = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: primero.inicio.reintegro_id } });
    const movimientosAntes = await prisma.movimientoStock.count({ where: { comprobante_referencia: { startsWith: "HU-E13:STOCK:" }, venta_id: f.pedido.id } });
    const segundo = await servicio.iniciarYContinuarReintegroPedidoWeb(adminInput(f.pedido.id, "Motivo distinto ignorado"));
    const extensionDespues = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    const reintegroDespues = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: primero.inicio.reintegro_id } });
    assert.equal(segundo.inicio.resultado, "REUTILIZADO");
    assert.equal(segundo.inicio.reintegro_id, primero.inicio.reintegro_id);
    assert.equal(segundo.pasos_locales.nota_credito_id, primero.pasos_locales.nota_credito_id);
    assert.equal(segundo.pasos_locales.contra_asiento_ingreso_id, primero.pasos_locales.contra_asiento_ingreso_id);
    assert.equal(await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: f.pedido.id, tipo_comprobante: "NOTA_CREDITO" } }), 1);
    assert.equal(await prisma.movimientoStock.count({ where: { comprobante_referencia: { startsWith: "HU-E13:STOCK:" }, venta_id: f.pedido.id } }), movimientosAntes);
    assert.equal(await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.pedido.id } }), 1);
    assert.equal(reintegroDespues.motivo, reintegroAntes.motivo);
    assert.equal(reintegroDespues.solicitado_por_id, reintegroAntes.solicitado_por_id);
    assert.equal(extensionDespues.deleted_at?.getTime(), extensionAntes.deleted_at?.getTime());
    assert.equal(extensionDespues.deleted_by, extensionAntes.deleted_by);
    assert.equal(extensionDespues.deletion_reason, extensionAntes.deletion_reason);
    assert.equal(extensionDespues.codigo_qr_retiro, null);
  });

  await t.test("crash después de Paso 0 deja intención durable y retry completa pasos locales", async () => {
    const f = await fixture();
    const inicio = await servicio.iniciarReintegroPedidoWebPaso0(clienteInput(f.pedido.id));
    assert.equal(await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: f.pedido.id, tipo_comprobante: "NOTA_CREDITO" } }), 0);
    assert.equal(await prisma.movimientoStock.count({ where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } } }), 0);
    assert.equal(await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.pedido.id } }), 0);
    const ecommerce = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    assert.equal(ecommerce.estado_ecommerce, "CANCELADO");
    assert.equal(await prisma.reintegroStockCompensacion.count({ where: { reintegro_id: inicio.reintegro_id } }), 1);
    const continuacion = await servicio.continuarPasosLocalesReintegroPedidoWeb(inicio.reintegro_id);
    assert.equal(continuacion.resultado, "PASOS_LOCALES_COMPLETOS");
  });

  await t.test("progreso parcial de stock procesa solo la hija pendiente", async () => {
    const f = await fixture({ lineas: [
      { variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 },
      { variante_sku_id: SKU_B_ID, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 2 },
    ] });
    const inicio = await servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id));
    const hijas = await prisma.reintegroStockCompensacion.findMany({
      where: { reintegro_id: inicio.reintegro_id },
      orderBy: { pedido_venta_item_id: "asc" },
    });
    await inventario.compensarVentaPagada({
      reintegro_id: inicio.reintegro_id,
      compensacion_id: hijas[0]!.id,
      registrado_por_id: admin.id,
      motivo: "Parcial T07",
    });
    const movimientoPrimero = (await prisma.reintegroStockCompensacion.findUniqueOrThrow({ where: { id: hijas[0]!.id } })).movimiento_stock_id;
    const continuacion = await servicio.continuarPasosLocalesReintegroPedidoWeb(inicio.reintegro_id);
    assert.equal(continuacion.compensaciones_completas, 2);
    assert.equal((await prisma.reintegroStockCompensacion.findUniqueOrThrow({ where: { id: hijas[0]!.id } })).movimiento_stock_id, movimientoPrimero);
    assert.equal(await prisma.movimientoStock.count({ where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } } }), 2);
  });

  await t.test("G11 ausente conserva E, NC y stock; luego puede reanudarse", async () => {
    const f = await fixture({ conIngreso: false });
    const resultado = await servicio.iniciarYContinuarReintegroPedidoWeb(clienteInput(f.pedido.id));
    assert.equal(resultado.pasos_locales.resultado, "PENDIENTE_INGRESO_ORIGINAL");
    const reintegroPendiente = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: resultado.inicio.reintegro_id } });
    assert.equal(reintegroPendiente.estado, "PENDIENTE");
    assert.equal(reintegroPendiente.ultimo_error_codigo, "INGRESO_ORIGINAL_NO_ENCONTRADO");
    assert.ok(reintegroPendiente.nota_credito_id);
    assert.equal(reintegroPendiente.contra_asiento_ingreso_id, null);
    assert.equal(await prisma.movimientoStock.count({ where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } } }), 1);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: reintegroPendiente.id } }), 0);
    await prisma.ingresoTesoreria.create({
      data: {
        pedido_venta_id: f.pedido.id,
        mercadopago_payment_id: f.paymentId,
        monto: f.pedido.total,
        fecha: new Date(),
        estado: "PENDIENTE_CONCILIACION",
        caja_virtual: "MERCADO_PAGO_CANAL_WEB",
      },
    });
    const retry = await servicio.continuarPasosLocalesReintegroPedidoWeb(reintegroPendiente.id);
    assert.equal(retry.resultado, "PASOS_LOCALES_COMPLETOS");
    assert.ok(retry.contra_asiento_ingreso_id);
  });

  await t.test("estado terminal sin cabecera es inconsistencia y no fabrica saga", async () => {
    const f = await fixture({ estado: "CANCELADO" });
    await prisma.pedidoVentaEcommerce.update({
      where: { id: f.ecommerce.id },
      data: {
        is_active: false,
        deleted_at: new Date(),
        deleted_by: admin.id,
        deletion_reason: "Terminal sin saga",
      },
    });
    await rechazaCon("REINTEGRO_INCONSISTENTE", () => servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id)));
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: f.pedido.id } }), 0);
  });

  await t.test("carrera cancelación cliente vs toma produce un único ganador coherente", async () => {
    const f = await fixture({ estado: "PAGO_CONFIRMADO" });
    const [cancelacion, toma] = await Promise.allSettled([
      servicio.iniciarReintegroPedidoWebPaso0(clienteInput(f.pedido.id)),
      pickPack.tomarPedido(f.pedido.id, admin.id),
    ]);
    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    const sagas = await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: f.pedido.id } });
    if (cancelacion.status === "fulfilled") {
      assert.equal(toma.status, "rejected");
      assert.equal(extension.estado_ecommerce, "CANCELADO");
      assert.equal(extension.operador_asignado_id, null);
      assert.equal(sagas, 1);
    } else {
      assert.equal(toma.status, "fulfilled");
      assert.equal(extension.estado_ecommerce, "EN_PREPARACION");
      assert.equal(extension.operador_asignado_id, admin.id);
      assert.equal(sagas, 0);
    }
  });

  await t.test("carrera cancelación admin vs toma revalida bajo lock sin lectura stale", async () => {
    const f = await fixture({ estado: "PAGO_CONFIRMADO" });
    const [cancelacion, toma] = await Promise.allSettled([
      servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id)),
      pickPack.tomarPedido(f.pedido.id, admin.id),
    ]);
    assert.equal(cancelacion.status, "fulfilled");
    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    assert.equal(extension.estado_ecommerce, "CANCELADO");
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: f.pedido.id } }), 1);
    assert.equal(extension.operador_asignado_id, toma.status === "fulfilled" ? admin.id : null);
  });

  await t.test("cancelación admin no falla con cuenta cliente inactiva y omite destinatario F3", async () => {
    const f = await fixture({ estado: "EN_PREPARACION" });
    await prisma.cuentaClienteWeb.update({
      where: { id: cuenta.id },
      data: {
        is_active: false,
        deleted_at: new Date(),
        deleted_by: admin.id,
        deletion_reason: "Fixture T09",
      },
    });
    let destinatario: string | null | undefined;
    const alCancelar = (payload: { cliente_web_cuenta_id: string | null }) => {
      destinatario = payload.cliente_web_cuenta_id;
    };
    domainEventBus.on("ecommerce:pedido_cancelado", alCancelar as never);
    try {
      const resultado = await servicio.iniciarReintegroPedidoWebPaso0(adminInput(f.pedido.id));
      assert.equal(resultado.resultado, "CREADO");
      assert.equal(destinatario, null);
    } finally {
      domainEventBus.off("ecommerce:pedido_cancelado", alCancelar as never);
      await prisma.cuentaClienteWeb.update({
        where: { id: cuenta.id },
        data: {
          is_active: true,
          deleted_at: null,
          deleted_by: null,
          deletion_reason: null,
        },
      });
    }
  });

  await t.test("T07 no crea intentos refund ni invocaciones MP", async () => {
    const f = await fixture();
    const antes = {
      refunds: await prisma.reintegroRefundIntento.count(),
      mp: await prisma.invocacionConectorPago.count({ where: { operacion: "SOLICITAR_REEMBOLSO" } }),
    };
    await servicio.iniciarYContinuarReintegroPedidoWeb(adminInput(f.pedido.id));
    assert.equal(await prisma.reintegroRefundIntento.count(), antes.refunds);
    assert.equal(await prisma.invocacionConectorPago.count({ where: { operacion: "SOLICITAR_REEMBOLSO" } }), antes.mp);
  });
});
