import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ErrorTecnicoMercadoPago } from "../../integraciones/mercadopago/adapter.ts";
import { ServiceError } from "../../errors/service-error.ts";

const DATABASE_URL = process.env.HU_E13_T08_INTEGRATION_DATABASE_URL;
const DEPOSITO_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const SKU_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

test("HU-E13 T08 — refund durable", { skip: !DATABASE_URL, timeout: 180_000 }, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, servicio, { PrismaClient }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./reintegro-refund.service.ts"),
    import("@prisma/client"),
  ]);
  const observador = new PrismaClient();
  t.after(async () => {
    await observador.$disconnect();
    await prisma.$disconnect();
  });
  const actor = await prisma.usuario.findFirstOrThrow({ where: { is_active: true, deleted_at: null }, select: { id: true } });

  async function fixture({ conContra = true }: { conContra?: boolean } = {}) {
    const paymentId = `t08-${randomUUID()}`;
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `T08-${randomUUID()}`,
        canal: "WEB",
        estado: "FACTURADO",
        total: 100,
        fecha_facturacion: new Date(),
        registrado_por_id: actor.id,
      },
    });
    const ecommerce = await prisma.pedidoVentaEcommerce.create({
      data: {
        pedido_venta_id: pedido.id,
        estado_ecommerce: "CANCELADO",
        mercadopago_payment_id: paymentId,
        fecha_pago_confirmado: new Date(),
        is_active: false,
        deleted_at: new Date(),
        deleted_by: actor.id,
        deletion_reason: "T08",
      },
    });
    const original = await prisma.comprobanteFiscal.create({
      data: {
        pedido_venta_id: pedido.id,
        tipo_comprobante: "FACTURA_B",
        cae_simulado: "12345678901234",
        qr_data_url: `data:image/png;base64,${randomUUID()}`,
        es_simulado: true,
        monto_total: 100,
        emitido_por_id: actor.id,
      },
    });
    const nota = await prisma.comprobanteFiscal.create({
      data: {
        pedido_venta_id: pedido.id,
        tipo_comprobante: "NOTA_CREDITO",
        cae_simulado: "22345678901234",
        qr_data_url: `data:image/png;base64,${randomUUID()}`,
        es_simulado: true,
        monto_total: 100,
        emitido_por_id: actor.id,
        comprobante_original_id: original.id,
      },
    });
    const reserva = await prisma.reserva.create({
      data: {
        variante_sku_id: SKU_ID,
        deposito_id: DEPOSITO_ID,
        cantidad: 1,
        fecha_inicio_reserva: new Date(Date.now() - 60_000),
        fecha_fin_reserva: new Date(),
        fecha_expiracion: new Date(Date.now() + 60_000),
        motivo: "T08",
        origen_reserva: "CHECKOUT_WEB",
        registrado_por_id: actor.id,
      },
    });
    const item = await prisma.pedidoVentaItem.create({
      data: {
        pedido_venta_id: pedido.id,
        variante_sku_id: SKU_ID,
        cantidad: 1,
        precio_unitario: 100,
        reserva_id: reserva.id,
        cantidad_facturada: 1,
      },
    });
    const movimiento = await prisma.movimientoStock.create({
      data: {
        deposito_destino_id: DEPOSITO_ID,
        tipo_movimiento: "INGRESO",
        comprobante_referencia: `HU-E13:STOCK:${pedido.id}:${item.id}`,
        registrado_por_id: actor.id,
        venta_id: pedido.id,
        items: { create: { variante_sku_id: SKU_ID, cantidad: 1, estado_origen: "VENDIDO", estado_destino: "DISPONIBLE" } },
      },
    });
    const ingreso = conContra ? await prisma.ingresoTesoreria.create({
      data: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: paymentId,
        monto: 100,
        fecha: new Date(),
        estado: "PENDIENTE_CONCILIACION",
        caja_virtual: "MERCADO_PAGO_CANAL_WEB",
      },
    }) : null;
    const contra = ingreso ? await prisma.contraAsientoIngreso.create({
      data: { ingreso_original_id: ingreso.id, pedido_venta_id: pedido.id, monto: 100, motivo: "T08" },
    }) : null;
    const reintegro = await prisma.reintegroPedidoWeb.create({
      data: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: paymentId,
        monto_total: 100,
        motivo: "T08",
        solicitado_por_tipo: "USUARIO",
        solicitado_por_id: actor.id,
        nota_credito_id: nota.id,
        contra_asiento_ingreso_id: contra?.id,
        compensaciones_stock: {
          create: {
            pedido_venta_item_id: item.id,
            variante_sku_id: SKU_ID,
            deposito_id: DEPOSITO_ID,
            cantidad: 1,
            clave_idempotencia: `HU-E13:STOCK:${pedido.id}:${item.id}`,
            movimiento_stock_id: movimiento.id,
            completed_at: new Date(),
          },
        },
      },
    });
    return { pedido, ecommerce, original, nota, movimiento, ingreso, contra, reintegro, paymentId };
  }

  const aprobado = (paymentId: string, refundId = `refund-${randomUUID()}`) => ({
    refund_id: refundId,
    payment_id: paymentId,
    monto: 100,
    estado: "APROBADO" as const,
  });
  const pendiente = (paymentId: string, refundId = `refund-${randomUUID()}`) => ({
    refund_id: refundId,
    payment_id: paymentId,
    monto: 100,
    estado: "PENDIENTE" as const,
  });
  const rechazado = (paymentId: string, refundId = `refund-${randomUUID()}`) => ({
    refund_id: refundId,
    payment_id: paymentId,
    monto: 100,
    estado: "RECHAZADO" as const,
  });

  await t.test("persist-before-call e inicial APPROVED", async () => {
    const f = await fixture();
    const pedidoAntes = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: f.pedido.id } });
    const ecommerceAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    const efectosAntes = {
      nc: await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: f.pedido.id, tipo_comprobante: "NOTA_CREDITO" } }),
      stock: await prisma.movimientoStock.count({ where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } } }),
      g11: await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.pedido.id } }),
    };
    let llamadas = 0;
    const refundPersistido = `refund-${f.paymentId}`;
    const sut = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string, key: string) => {
        llamadas++;
        const intento = await observador.reintegroRefundIntento.findUniqueOrThrow({ where: { clave_idempotencia: key } });
        const cabecera = await observador.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: intento.reintegro_id } });
        assert.equal(intento.estado, "PENDIENTE");
        assert.equal(intento.origen, "INICIAL");
        assert.equal(intento.numero, 1);
        assert.ok(cabecera.proximo_reintento_at);
        return aprobado(paymentId, refundPersistido);
      },
    });
    const resultado = await sut.continuarRefundPedidoWeb(f.reintegro.id);
    assert.equal(resultado.resultado, "APROBADO");
    assert.equal(llamadas, 1);
    const cabecera = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: f.reintegro.id } });
    const intento = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id } });
    assert.equal(cabecera.estado, "APROBADO");
    assert.equal(cabecera.intento_aprobado_id, intento.id);
    assert.equal(cabecera.proximo_reintento_at, null);
    assert.equal(intento.estado, "APROBADO");
    assert.equal(intento.refund_id, refundPersistido);
    assert.deepEqual(await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: f.pedido.id } }), pedidoAntes);
    assert.deepEqual(await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } }), ecommerceAntes);
    assert.deepEqual({
      nc: await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: f.pedido.id, tipo_comprobante: "NOTA_CREDITO" } }),
      stock: await prisma.movimientoStock.count({ where: { venta_id: f.pedido.id, comprobante_referencia: { startsWith: "HU-E13:STOCK:" } } }),
      g11: await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.pedido.id } }),
    }, efectosAntes);
    const posterior = await sut.continuarRefundPedidoWeb(f.reintegro.id);
    assert.equal(posterior.resultado, "APROBADO_EXISTENTE");
    assert.equal(llamadas, 1);
  });

  await t.test("dos ejecuciones iniciales concurrentes comparten fila y key", async () => {
    const f = await fixture();
    const keys: string[] = [];
    const refundId = `refund-${randomUUID()}`;
    const sut = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string, key: string) => {
        keys.push(key);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return aprobado(paymentId, refundId);
      },
    });
    const resultados = await Promise.all([
      sut.continuarRefundPedidoWeb(f.reintegro.id),
      sut.continuarRefundPedidoWeb(f.reintegro.id),
    ]);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id } }), 1);
    assert.equal(new Set(keys).size, 1);
    assert.equal(new Set(resultados.map((r) => "intento_id" in r ? r.intento_id : null)).size, 1);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id, estado: "APROBADO" } }), 1);
  });

  await t.test("errores técnicos reutilizan intento/key y aplican secuencia hasta cap 360", async () => {
    const f = await fixture();
    const ahora = new Date("2026-10-10T12:00:00.000Z");
    const keys: string[] = [];
    const sut = servicio.crearServicioReintegroRefund({
      ahora: () => ahora,
      solicitarReembolso: async (_paymentId: string, key: string) => {
        keys.push(key);
        throw new ErrorTecnicoMercadoPago("PASARELA_TIMEOUT", "seguro", "TIMEOUT");
      },
    });
    const esperados = [5, 10, 20, 40, 80, 160, 320, 360, 360];
    for (let i = 0; i < esperados.length; i++) {
      const resultado = await sut.continuarRefundPedidoWeb(f.reintegro.id);
      assert.equal(resultado.resultado, "ERROR_TECNICO");
      assert.equal(resultado.proximo_reintento_at.getTime(), ahora.getTime() + esperados[i]! * 60_000);
    }
    const intento = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id } });
    assert.equal(intento.intentos_tecnicos, 9);
    assert.equal(intento.estado, "PENDIENTE");
    assert.equal(new Set(keys).size, 1);
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "CANCELADO");
  });

  await t.test("RED, 429, 5xx y respuesta ambigua son técnicos", async () => {
    for (const causa of ["RED", "HTTP_429", "HTTP_5XX", "RESPUESTA_AMBIGUA"] as const) {
      const f = await fixture();
      const sut = servicio.crearServicioReintegroRefund({
        solicitarReembolso: async () => { throw new ErrorTecnicoMercadoPago("PASARELA", "seguro", causa); },
      });
      const resultado = await sut.continuarRefundPedidoWeb(f.reintegro.id);
      assert.equal(resultado.resultado, "ERROR_TECNICO");
      const intento = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id } });
      assert.equal(intento.intentos_tecnicos, 1);
      assert.equal(intento.error_codigo, `MP_${causa}`);
    }
  });

  await t.test("PENDING programa 15 minutos sin incrementar y reutiliza key", async () => {
    const f = await fixture();
    const ahora = new Date("2026-10-10T12:00:00.000Z");
    const keys: string[] = [];
    const refundPendiente = `refund-${f.paymentId}`;
    const sut = servicio.crearServicioReintegroRefund({
      ahora: () => ahora,
      solicitarReembolso: async (paymentId: string, key: string) => {
        keys.push(key);
        return pendiente(paymentId, refundPendiente);
      },
    });
    for (let i = 0; i < 2; i++) {
      const resultado = await sut.continuarRefundPedidoWeb(f.reintegro.id);
      assert.equal(resultado.resultado, "PENDIENTE");
      assert.equal(resultado.proximo_reintento_at.getTime(), ahora.getTime() + 15 * 60_000);
    }
    const intento = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id } });
    assert.equal(intento.intentos_tecnicos, 0);
    assert.equal(intento.refund_id, refundPendiente);
    assert.equal(new Set(keys).size, 1);
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "CANCELADO");
  });

  await t.test("HTTP definitivos 400/401/403/404 quedan RECHAZADOS", async () => {
    for (const codigo of ["PASARELA_RESPUESTA_INVALIDA", "PASARELA_RECHAZO_CREDENCIALES", "PAGO_NO_ENCONTRADO"] as const) {
      const f = await fixture();
      const sut = servicio.crearServicioReintegroRefund({
        solicitarReembolso: async () => { throw new ServiceError(codigo, "seguro"); },
      });
      const resultado = await sut.continuarRefundPedidoWeb(f.reintegro.id);
      assert.equal(resultado.resultado, "RECHAZADO");
      const cabecera = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: f.reintegro.id } });
      assert.equal(cabecera.estado, "RECHAZADO");
      assert.equal(cabecera.proximo_reintento_at, null);
      assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "CANCELADO");
    }
  });

  await t.test("rechazo remoto conserva efectos y habilita reintento manual con nueva key", async () => {
    const f = await fixture();
    let modo: "RECHAZADO" | "PENDIENTE" | "APROBADO" | "TECNICO" = "RECHAZADO";
    const keys: string[] = [];
    const refundInicial = `refund-inicial-${f.paymentId}`;
    const refundManual = `refund-manual-${f.paymentId}`;
    const sut = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string, key: string) => {
        keys.push(key);
        if (modo === "RECHAZADO") return rechazado(paymentId, refundInicial);
        if (modo === "PENDIENTE") return pendiente(paymentId, refundManual);
        if (modo === "TECNICO") throw new ErrorTecnicoMercadoPago("PASARELA_TIMEOUT", "seguro", "TIMEOUT");
        return aprobado(paymentId, refundManual);
      },
    });
    assert.equal((await sut.continuarRefundPedidoWeb(f.reintegro.id)).resultado, "RECHAZADO");
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "CANCELADO");
    const intentoInicialAntes = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id, numero: 1 } });
    modo = "PENDIENTE";
    const manual = await sut.solicitarReintentoManualRefund({ reintegro_id: f.reintegro.id, usuario_id: actor.id, motivo: "Nueva decisión" });
    assert.equal(manual.resultado, "PENDIENTE");
    const intentoManual = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id, numero: 2 } });
    assert.equal(intentoManual.origen, "REINTENTO_MANUAL");
    assert.equal(intentoManual.creado_por_id, actor.id);
    assert.equal(intentoManual.motivo_reintento, "Nueva decisión");
    assert.notEqual(intentoManual.clave_idempotencia, intentoInicialAntes.clave_idempotencia);
    modo = "TECNICO";
    const tecnico = await sut.solicitarReintentoManualRefund({ reintegro_id: f.reintegro.id, usuario_id: actor.id, motivo: "No reescribir" });
    assert.equal(tecnico.resultado, "ERROR_TECNICO");
    modo = "APROBADO";
    const final = await sut.solicitarReintentoManualRefund({ reintegro_id: f.reintegro.id, usuario_id: actor.id, motivo: "No reescribir" });
    assert.equal(final.resultado, "APROBADO");
    const inicialDespues = await prisma.reintegroRefundIntento.findUniqueOrThrow({ where: { id: intentoInicialAntes.id } });
    const manualDespues = await prisma.reintegroRefundIntento.findUniqueOrThrow({ where: { id: intentoManual.id } });
    assert.deepEqual(inicialDespues, intentoInicialAntes);
    assert.equal(manualDespues.motivo_reintento, "Nueva decisión");
    assert.equal(manualDespues.estado, "APROBADO");
    assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: f.reintegro.id } })).intento_aprobado_id, intentoManual.id);
    assert.equal(new Set(keys.slice(1)).size, 1);
  });

  await t.test("repetición y concurrencia manual reutilizan una sola fila pendiente", async () => {
    const f = await fixture();
    let fase: "RECHAZAR" | "PENDING" = "RECHAZAR";
    const keys: string[] = [];
    const sut = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string, key: string) => {
        keys.push(key);
        if (fase === "RECHAZAR") return rechazado(paymentId);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return pendiente(paymentId, `refund-manual-${f.paymentId}`);
      },
    });
    await sut.continuarRefundPedidoWeb(f.reintegro.id);
    fase = "PENDING";
    const respuestas = await Promise.all([
      sut.solicitarReintentoManualRefund({ reintegro_id: f.reintegro.id, usuario_id: actor.id, motivo: "Manual único" }),
      sut.solicitarReintentoManualRefund({ reintegro_id: f.reintegro.id, usuario_id: actor.id, motivo: "Otro motivo ignorado" }),
    ]);
    assert.deepEqual(respuestas.map((r) => r.intento_reutilizado).sort(), [false, true]);
    assert.equal(new Set(respuestas.map((r) => "intento_id" in r ? r.intento_id : null)).size, 1);
    const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: f.reintegro.id }, orderBy: { numero: "asc" } });
    assert.equal(intentos.length, 2);
    assert.ok(["Manual único", "Otro motivo ignorado"].includes(intentos[1]!.motivo_reintento ?? ""));
    assert.equal(intentos[1]!.creado_por_id, actor.id);
    assert.equal(new Set(keys.slice(1)).size, 1);
  });

  await t.test("motivo vacío y manual después de aprobado no crean intentos", async () => {
    const f = await fixture();
    const sut = servicio.crearServicioReintegroRefund({ solicitarReembolso: async (paymentId: string) => aprobado(paymentId) });
    await assert.rejects(() => sut.solicitarReintentoManualRefund({ reintegro_id: f.reintegro.id, usuario_id: actor.id, motivo: "   " }),
      (error: unknown) => error instanceof ServiceError && error.code === "MOTIVO_REQUERIDO");
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id } }), 0);
    await sut.continuarRefundPedidoWeb(f.reintegro.id);
    await assert.rejects(() => sut.solicitarReintentoManualRefund({ reintegro_id: f.reintegro.id, usuario_id: actor.id, motivo: "Otra" }),
      (error: unknown) => error instanceof ServiceError && error.code === "REINTEGRO_APROBADO");
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id } }), 1);
  });

  await t.test("respuesta tardía PENDING no degrada APROBADO", async () => {
    const f = await fixture();
    let llamada = 0;
    const refundMonotono = `refund-${f.paymentId}`;
    const sut = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string) => {
        llamada++;
        if (llamada === 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return aprobado(paymentId, refundMonotono);
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
        return pendiente(paymentId, refundMonotono);
      },
    });
    await Promise.all([sut.continuarRefundPedidoWeb(f.reintegro.id), sut.continuarRefundPedidoWeb(f.reintegro.id)]);
    const cabecera = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: f.reintegro.id } });
    const intento = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id } });
    assert.equal(cabecera.estado, "APROBADO");
    assert.equal(intento.estado, "APROBADO");
    assert.equal(intento.refund_id, refundMonotono);
  });

  await t.test("refund_id ligado a otro intento se rechaza como inconsistencia", async () => {
    const refundCompartido = `refund-${randomUUID()}`;
    const primero = await fixture();
    const segundo = await fixture();
    const sutPrimero = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string) => pendiente(paymentId, refundCompartido),
    });
    await sutPrimero.continuarRefundPedidoWeb(primero.reintegro.id);
    const sutSegundo = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string) => aprobado(paymentId, refundCompartido),
    });
    await assert.rejects(() => sutSegundo.continuarRefundPedidoWeb(segundo.reintegro.id),
      (error: unknown) => error instanceof ServiceError && error.code === "REFUND_ID_INCONSISTENTE");
    const cabecera = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: segundo.reintegro.id } });
    const intento = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: segundo.reintegro.id } });
    assert.equal(cabecera.estado, "PENDIENTE");
    assert.equal(intento.estado, "PENDIENTE");
    assert.equal(intento.refund_id, null);
  });

  await t.test("crash después del commit recupera mismo intento y key", async () => {
    const f = await fixture();
    const keys: string[] = [];
    const sut = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string, key: string) => { keys.push(key); return aprobado(paymentId); },
    });
    const preparado = await sut.prepararIntentoRefundAutomatico(f.reintegro.id);
    assert.equal(preparado.resultado, "LISTO_PARA_F1");
    const intentoAntes = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: f.reintegro.id } });
    assert.equal(intentoAntes.clave_idempotencia, preparado.resultado === "LISTO_PARA_F1" ? preparado.clave_idempotencia : "");
    assert.ok((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: f.reintegro.id } })).proximo_reintento_at);
    await sut.continuarRefundPedidoWeb(f.reintegro.id);
    assert.equal(keys[0], intentoAntes.clave_idempotencia);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id } }), 1);
  });

  await t.test("G11 incompleto no crea intento ni llama F1", async () => {
    const f = await fixture({ conContra: false });
    let llamadas = 0;
    const sut = servicio.crearServicioReintegroRefund({
      solicitarReembolso: async (paymentId: string) => { llamadas++; return aprobado(paymentId); },
    });
    const resultado = await sut.continuarRefundPedidoWeb(f.reintegro.id);
    assert.equal(resultado.resultado, "PENDIENTE_PASOS_LOCALES");
    assert.equal(llamadas, 0);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id } }), 0);
  });
});
