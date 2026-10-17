import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { TipoComprobanteVenta, type EstadoPedidoVenta } from "@prisma/client";

const DATABASE_URL = process.env.HU_E13_T03_INTEGRATION_DATABASE_URL;

test("HU-E13 T03 — Nota de Crédito total, idempotente y transaccional", {
  skip: !DATABASE_URL,
  timeout: 120_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, servicio, { ServiceError }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./comprobante-fiscal.service.ts"),
    import("../../errors/service-error.ts"),
  ]);
  t.after(() => prisma.$disconnect());

  const emisor = await prisma.usuario.findFirstOrThrow({ where: { is_active: true }, select: { id: true } });

  async function fixture(options: {
    canal?: "WEB" | "MOSTRADOR";
    estado?: EstadoPedidoVenta;
    montoPedido?: number;
    montoOriginal?: number;
    tipoOriginal?: TipoComprobanteVenta;
    pedidoInactivo?: boolean;
  } = {}) {
    const id = randomUUID();
    const paymentId = `e13-t03-${randomUUID()}`;
    const montoPedido = options.montoPedido ?? 12500;
    const pedido = await prisma.pedidoVenta.create({
      data: {
        id,
        numero_venta: `T03-${randomUUID()}`,
        canal: options.canal ?? "WEB",
        estado: options.estado ?? "FACTURADO",
        total: montoPedido,
        fecha_facturacion: new Date(),
        registrado_por_id: emisor.id,
        is_active: !options.pedidoInactivo,
        deleted_at: options.pedidoInactivo ? new Date("2026-10-08T12:00:00.000Z") : null,
        deleted_by: options.pedidoInactivo ? emisor.id : null,
        deletion_reason: options.pedidoInactivo ? "Cancelación HU-E13 previa a NC" : null,
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
        deletion_reason: "Fixture T03",
      },
    });
    const originalBase = await prisma.comprobanteFiscal.create({
      data: {
        pedido_venta_id: pedido.id,
        tipo_comprobante: TipoComprobanteVenta.FACTURA_B,
        cae_simulado: "12345678901234",
        qr_data_url: `data:image/png;base64,${id}`,
        es_simulado: true,
        monto_total: options.montoOriginal ?? montoPedido,
        emitido_por_id: emisor.id,
      },
    });
    const original = options.tipoOriginal === TipoComprobanteVenta.NOTA_CREDITO
      ? await prisma.comprobanteFiscal.create({
        data: {
          pedido_venta_id: pedido.id,
          tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO,
          cae_simulado: "22345678901234",
          qr_data_url: `data:image/png;base64,nc-${id}`,
          es_simulado: true,
          monto_total: montoPedido,
          emitido_por_id: emisor.id,
          comprobante_original_id: originalBase.id,
        },
      })
      : options.tipoOriginal && options.tipoOriginal !== TipoComprobanteVenta.FACTURA_B
        ? await prisma.comprobanteFiscal.update({
          where: { id: originalBase.id },
          data: { tipo_comprobante: options.tipoOriginal },
        })
        : originalBase;
    const reintegro = await prisma.reintegroPedidoWeb.create({
      data: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: paymentId,
        monto_total: montoPedido,
        motivo: "Cancelación T03",
        solicitado_por_tipo: "SISTEMA",
      },
    });
    return { pedido, ecommerce, original, originalBase, reintegro };
  }

  function inputDe(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      reintegro_id: f.reintegro.id,
      pedido_venta_id: f.pedido.id,
      comprobante_original_id: f.original.id,
      emitido_por_id: emisor.id,
    };
  }

  async function rechazaCon(codigo: string, operacion: () => Promise<unknown>) {
    await assert.rejects(operacion, (error: unknown) => error instanceof ServiceError && error.code === codigo);
  }

  await t.test("crea una NC total vinculada sin mutar factura, pedido ni extensión", async () => {
    const f = await fixture();
    const originalAntes = await prisma.comprobanteFiscal.findUniqueOrThrow({ where: { id: f.original.id } });
    const stockAntes = await prisma.movimientoStock.count();
    const contraAntes = await prisma.contraAsientoIngreso.count();
    const refundsAntes = await prisma.reintegroRefundIntento.count();

    const resultado = await servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f));

    assert.equal(resultado.resultado, "CREADO");
    const nota = await prisma.comprobanteFiscal.findUniqueOrThrow({ where: { id: resultado.nota_credito_id } });
    assert.equal(nota.tipo_comprobante, TipoComprobanteVenta.NOTA_CREDITO);
    assert.equal(nota.pedido_venta_id, f.pedido.id);
    assert.equal(nota.comprobante_original_id, f.original.id);
    assert.equal(nota.monto_total.toString(), f.pedido.total.toString());
    assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: f.reintegro.id } })).nota_credito_id, nota.id);

    const originalDespues = await prisma.comprobanteFiscal.findUniqueOrThrow({ where: { id: f.original.id } });
    assert.deepEqual(originalDespues, originalAntes);
    assert.equal((await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: f.pedido.id } })).estado, "FACTURADO");
    assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } })).estado_ecommerce, "CANCELADO");
    assert.equal(await prisma.movimientoStock.count(), stockAntes);
    assert.equal(await prisma.contraAsientoIngreso.count(), contraAntes);
    assert.equal(await prisma.reintegroRefundIntento.count(), refundsAntes);
  });

  await t.test("retry secuencial reutiliza la misma NC", async () => {
    const f = await fixture();
    const primero = await servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f));
    const segundo = await servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f));
    assert.equal(primero.resultado, "CREADO");
    assert.equal(segundo.resultado, "YA_EXISTENTE");
    assert.equal(segundo.nota_credito_id, primero.nota_credito_id);
    assert.equal(await prisma.comprobanteFiscal.count({
      where: { pedido_venta_id: f.pedido.id, tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO },
    }), 1);
  });

  await t.test("dos solicitudes concurrentes crean una única NC HU-E13", async () => {
    const f = await fixture();
    const resultados = await Promise.all([
      servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)),
      servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)),
    ]);
    assert.deepEqual(resultados.map((resultado) => resultado.resultado).sort(), ["CREADO", "YA_EXISTENTE"]);
    assert.equal(new Set(resultados.map((resultado) => resultado.nota_credito_id)).size, 1);
    assert.equal(await prisma.comprobanteFiscal.count({
      where: { pedido_venta_id: f.pedido.id, tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO },
    }), 1);
  });

  await t.test("pedido FACTURADO con baja lógica conserva todos sus campos y admite concurrencia/retry", async () => {
    const f = await fixture({ pedidoInactivo: true });
    const antes = await prisma.pedidoVenta.findUniqueOrThrow({
      where: { id: f.pedido.id },
      select: { estado: true, is_active: true, deleted_at: true, deleted_by: true, deletion_reason: true },
    });

    const concurrentes = await Promise.all([
      servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)),
      servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)),
    ]);
    const retry = await servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f));

    assert.deepEqual(concurrentes.map((resultado) => resultado.resultado).sort(), ["CREADO", "YA_EXISTENTE"]);
    assert.equal(new Set(concurrentes.map((resultado) => resultado.nota_credito_id)).size, 1);
    assert.equal(retry.resultado, "YA_EXISTENTE");
    assert.equal(retry.nota_credito_id, concurrentes[0]!.nota_credito_id);
    assert.equal(await prisma.comprobanteFiscal.count({
      where: { pedido_venta_id: f.pedido.id, tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO },
    }), 1);

    const despues = await prisma.pedidoVenta.findUniqueOrThrow({
      where: { id: f.pedido.id },
      select: { estado: true, is_active: true, deleted_at: true, deleted_by: true, deletion_reason: true },
    });
    assert.deepEqual(despues, antes);
    assert.deepEqual(despues, {
      estado: "FACTURADO",
      is_active: false,
      deleted_at: new Date("2026-10-08T12:00:00.000Z"),
      deleted_by: emisor.id,
      deletion_reason: "Cancelación HU-E13 previa a NC",
    });
  });

  await t.test("rollback posterior al helper revierte NC y vínculo", async () => {
    const f = await fixture();
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await servicio.emitirNotaCreditoReintegroPedidoWebTx(tx, inputDe(f));
        throw new Error("ROLLBACK_T03");
      }),
      /ROLLBACK_T03/,
    );
    assert.equal(await prisma.comprobanteFiscal.count({
      where: { pedido_venta_id: f.pedido.id, tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO },
    }), 0);
    assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: f.reintegro.id } })).nota_credito_id, null);
  });

  await t.test("rechaza pedido no WEB", async () => {
    const f = await fixture({ canal: "MOSTRADOR" });
    await rechazaCon("PEDIDO_NO_APTO_NOTA_CREDITO", () => servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)));
  });

  await t.test("rechaza pedido no FACTURADO", async () => {
    const f = await fixture({ estado: "RESERVADO" });
    await rechazaCon("PEDIDO_NO_APTO_NOTA_CREDITO", () => servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)));
  });

  await t.test("rechaza comprobante de otro pedido", async () => {
    const f = await fixture();
    const otro = await fixture();
    await rechazaCon("COMPROBANTE_ORIGINAL_INVALIDO", () => servicio.emitirNotaCreditoReintegroPedidoWeb({
      ...inputDe(f),
      comprobante_original_id: otro.original.id,
    }));
  });

  await t.test("rechaza una Nota de Crédito como comprobante original", async () => {
    const f = await fixture({ tipoOriginal: TipoComprobanteVenta.NOTA_CREDITO });
    await rechazaCon("COMPROBANTE_ORIGINAL_INVALIDO", () => servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)));
  });

  await t.test("rechaza reintegro perteneciente a otro pedido", async () => {
    const f = await fixture();
    const otro = await fixture();
    await rechazaCon("REINTEGRO_INCOMPATIBLE", () => servicio.emitirNotaCreditoReintegroPedidoWeb({
      ...inputDe(otro),
      reintegro_id: f.reintegro.id,
    }));
  });

  await t.test("rechaza reintegro que no representa el total facturado", async () => {
    const f = await fixture({ montoOriginal: 12000 });
    await rechazaCon("MONTO_REINTEGRO_INVALIDO", () => servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f)));
  });

  await t.test("una NC fiscal ajena puede coexistir con la NC HU-E13", async () => {
    const f = await fixture();
    const ajena = await prisma.comprobanteFiscal.create({
      data: {
        pedido_venta_id: f.pedido.id,
        tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO,
        cae_simulado: "32345678901234",
        qr_data_url: `data:image/png;base64,ajena-${randomUUID()}`,
        es_simulado: true,
        monto_total: f.pedido.total,
        emitido_por_id: emisor.id,
        comprobante_original_id: f.original.id,
      },
    });
    const resultado = await servicio.emitirNotaCreditoReintegroPedidoWeb(inputDe(f));
    assert.notEqual(resultado.nota_credito_id, ajena.id);
    assert.equal(await prisma.comprobanteFiscal.count({
      where: { pedido_venta_id: f.pedido.id, tipo_comprobante: TipoComprobanteVenta.NOTA_CREDITO },
    }), 2);
  });
});
