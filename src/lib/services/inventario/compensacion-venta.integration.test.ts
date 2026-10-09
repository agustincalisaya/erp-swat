import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DATABASE_URL = process.env.HU_E13_T04_INTEGRATION_DATABASE_URL;
const DEPOSITO_CENTRAL_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
const SKU_A_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";
const SKU_B_ID = "864c2765-cbdd-41eb-837a-e12814b62868";
const SKU_C_ID = "407e729d-47c3-404d-a89a-0a9c1f85a3db";

test("HU-E13 T04 — compensación VENDIDO a DISPONIBLE", {
  skip: !DATABASE_URL,
  timeout: 120_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, servicio, { ServiceError }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./compensacion-venta.service.ts"),
    import("../../errors/service-error.ts"),
  ]);
  t.after(() => prisma.$disconnect());

  const actor = await prisma.usuario.findFirstOrThrow({ where: { is_active: true }, select: { id: true } });

  type Linea = { variante_sku_id: string; deposito_id: string; cantidad: number };
  async function fixture(lineas: Linea[]) {
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `T04-${randomUUID()}`,
        canal: "WEB",
        estado: "FACTURADO",
        total: lineas.reduce((total, linea) => total + linea.cantidad * 100, 0),
        fecha_facturacion: new Date(),
        registrado_por_id: actor.id,
      },
    });
    const paymentId = `e13-t04-${randomUUID()}`;
    const ecommerce = await prisma.pedidoVentaEcommerce.create({
      data: {
        pedido_venta_id: pedido.id,
        estado_ecommerce: "CANCELADO",
        mercadopago_payment_id: paymentId,
        fecha_pago_confirmado: new Date(),
        is_active: false,
        deleted_at: new Date(),
        deletion_reason: "Fixture T04",
      },
    });
    const reintegro = await prisma.reintegroPedidoWeb.create({
      data: {
        pedido_venta_id: pedido.id,
        mercadopago_payment_id: paymentId,
        monto_total: pedido.total,
        motivo: "Cancelación T04",
        solicitado_por_tipo: "SISTEMA",
      },
    });
    const creadas = [];
    for (const linea of lineas) {
      const reserva = await prisma.reserva.create({
        data: {
          variante_sku_id: linea.variante_sku_id,
          deposito_id: linea.deposito_id,
          cantidad: linea.cantidad,
          fecha_inicio_reserva: new Date(Date.now() - 86_400_000),
          fecha_fin_reserva: new Date(),
          fecha_expiracion: new Date(Date.now() + 86_400_000),
          motivo: "Venta pagada T04",
          origen_reserva: "CHECKOUT_WEB",
          registrado_por_id: actor.id,
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
      const venta = await prisma.movimientoStock.create({
        data: {
          deposito_origen_id: linea.deposito_id,
          tipo_movimiento: "EGRESO",
          comprobante_referencia: `RESERVA-CONFIRMADA-${reserva.id}`,
          registrado_por_id: actor.id,
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
      const compensacion = await prisma.reintegroStockCompensacion.create({
        data: {
          reintegro_id: reintegro.id,
          pedido_venta_item_id: item.id,
          variante_sku_id: linea.variante_sku_id,
          deposito_id: linea.deposito_id,
          cantidad: linea.cantidad,
          clave_idempotencia: `HU-E13:STOCK:${pedido.id}:${item.id}`,
        },
      });
      creadas.push({ ...linea, reserva, item, venta, compensacion });
    }
    return { pedido, ecommerce, reintegro, lineas: creadas };
  }

  function input(f: Awaited<ReturnType<typeof fixture>>, indice = 0) {
    return {
      reintegro_id: f.reintegro.id,
      compensacion_id: f.lineas[indice]!.compensacion.id,
      registrado_por_id: actor.id,
      motivo: "Reintegro total HU-E13",
    };
  }

  async function cantidadStock(variante_sku_id: string, deposito_id: string) {
    return (await prisma.stockDeposito.findUniqueOrThrow({
      where: { variante_sku_id_deposito_id: { variante_sku_id, deposito_id } },
      select: { cantidad: true },
    })).cantidad;
  }

  async function rechazaCon(codigo: string, operacion: () => Promise<unknown>) {
    await assert.rejects(operacion, (error: unknown) => error instanceof ServiceError && error.code === codigo);
  }

  await t.test("una línea incrementa stock, crea INGRESO VENDIDO-DISPONIBLE y completa la hija", async () => {
    const f = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 2 }]);
    const linea = f.lineas[0]!;
    const stockAntes = await cantidadStock(linea.variante_sku_id, linea.deposito_id);
    const pedidoAntes = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: f.pedido.id } });
    const ecommerceAntes = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } });
    const ncAntes = await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: f.pedido.id, tipo_comprobante: "NOTA_CREDITO" } });
    const contraAntes = await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.pedido.id } });
    const refundAntes = await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id } });

    const resultado = await servicio.compensarVentaPagada(input(f));

    assert.equal(resultado.resultado, "CREADO");
    assert.equal(await cantidadStock(linea.variante_sku_id, linea.deposito_id), stockAntes + linea.cantidad);
    const movimiento = await prisma.movimientoStock.findUniqueOrThrow({
      where: { id: resultado.movimiento_stock_id },
      include: { items: true },
    });
    assert.equal(movimiento.tipo_movimiento, "INGRESO");
    assert.equal(movimiento.deposito_origen_id, null);
    assert.equal(movimiento.deposito_destino_id, linea.deposito_id);
    assert.equal(movimiento.comprobante_referencia, linea.compensacion.clave_idempotencia);
    assert.equal(movimiento.venta_id, f.pedido.id);
    assert.deepEqual(movimiento.items.map((item) => ({
      sku: item.variante_sku_id,
      cantidad: item.cantidad,
      origen: item.estado_origen,
      destino: item.estado_destino,
    })), [{ sku: linea.variante_sku_id, cantidad: linea.cantidad, origen: "VENDIDO", destino: "DISPONIBLE" }]);
    const completada = await prisma.reintegroStockCompensacion.findUniqueOrThrow({ where: { id: linea.compensacion.id } });
    assert.equal(completada.movimiento_stock_id, movimiento.id);
    assert.ok(completada.completed_at);
    assert.deepEqual(await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: f.pedido.id } }), pedidoAntes);
    assert.deepEqual(await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: f.ecommerce.id } }), ecommerceAntes);
    assert.equal(await prisma.comprobanteFiscal.count({ where: { pedido_venta_id: f.pedido.id, tipo_comprobante: "NOTA_CREDITO" } }), ncAntes);
    assert.equal(await prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: f.pedido.id } }), contraAntes);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: f.reintegro.id } }), refundAntes);
  });

  await t.test("retry secuencial devuelve el mismo movimiento sin duplicar stock", async () => {
    const f = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    const linea = f.lineas[0]!;
    const inicial = await cantidadStock(linea.variante_sku_id, linea.deposito_id);
    const primero = await servicio.compensarVentaPagada(input(f));
    const segundo = await servicio.compensarVentaPagada(input(f));
    assert.equal(primero.resultado, "CREADO");
    assert.equal(segundo.resultado, "YA_EXISTENTE");
    assert.equal(segundo.movimiento_stock_id, primero.movimiento_stock_id);
    assert.equal(await cantidadStock(linea.variante_sku_id, linea.deposito_id), inicial + 1);
    assert.equal(await prisma.movimientoStock.count({ where: { comprobante_referencia: linea.compensacion.clave_idempotencia } }), 1);
  });

  await t.test("concurrencia real produce un incremento y un movimiento", async () => {
    const f = await fixture([{ variante_sku_id: SKU_B_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 3 }]);
    const linea = f.lineas[0]!;
    const inicial = await cantidadStock(linea.variante_sku_id, linea.deposito_id);
    const resultados = await Promise.all([
      servicio.compensarVentaPagada(input(f)),
      servicio.compensarVentaPagada(input(f)),
    ]);
    assert.deepEqual(resultados.map((resultado) => resultado.resultado).sort(), ["CREADO", "YA_EXISTENTE"]);
    assert.equal(new Set(resultados.map((resultado) => resultado.movimiento_stock_id)).size, 1);
    assert.equal(await cantidadStock(linea.variante_sku_id, linea.deposito_id), inicial + 3);
    assert.equal(await prisma.movimientoStock.count({ where: { comprobante_referencia: linea.compensacion.clave_idempotencia } }), 1);
  });

  await t.test("rollback revierte stock, movimiento y vínculo", async () => {
    const f = await fixture([{ variante_sku_id: SKU_C_ID, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 2 }]);
    const linea = f.lineas[0]!;
    const inicial = await cantidadStock(linea.variante_sku_id, linea.deposito_id);
    await assert.rejects(prisma.$transaction(async (tx) => {
      await servicio.compensarVentaPagadaTx(tx, input(f));
      throw new Error("ROLLBACK_T04");
    }), /ROLLBACK_T04/);
    assert.equal(await cantidadStock(linea.variante_sku_id, linea.deposito_id), inicial);
    assert.equal(await prisma.movimientoStock.count({ where: { comprobante_referencia: linea.compensacion.clave_idempotencia } }), 0);
    const pendiente = await prisma.reintegroStockCompensacion.findUniqueOrThrow({ where: { id: linea.compensacion.id } });
    assert.equal(pendiente.movimiento_stock_id, null);
    assert.equal(pendiente.completed_at, null);
  });

  await t.test("multi-item procesa tres SKU en dos depósitos con cantidades independientes", async () => {
    const f = await fixture([
      { variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 },
      { variante_sku_id: SKU_B_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 2 },
      { variante_sku_id: SKU_C_ID, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 3 },
    ]);
    const iniciales = await Promise.all(f.lineas.map((linea) => cantidadStock(linea.variante_sku_id, linea.deposito_id)));
    const resultados = [];
    for (let indice = 0; indice < f.lineas.length; indice++) resultados.push(await servicio.compensarVentaPagada(input(f, indice)));
    assert.deepEqual(resultados.map((resultado) => resultado.resultado), ["CREADO", "CREADO", "CREADO"]);
    for (let indice = 0; indice < f.lineas.length; indice++) {
      const linea = f.lineas[indice]!;
      assert.equal(await cantidadStock(linea.variante_sku_id, linea.deposito_id), iniciales[indice]! + linea.cantidad);
    }
    assert.equal(await prisma.reintegroStockCompensacion.count({
      where: { reintegro_id: f.reintegro.id, movimiento_stock_id: { not: null }, completed_at: { not: null } },
    }), 3);
  });

  await t.test("progreso parcial reutiliza completadas y procesa solo faltantes", async () => {
    const f = await fixture([
      { variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 },
      { variante_sku_id: SKU_C_ID, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 1 },
    ]);
    const primero = await servicio.compensarVentaPagada(input(f, 0));
    const stockCompletado = await cantidadStock(f.lineas[0]!.variante_sku_id, f.lineas[0]!.deposito_id);
    const resultados = [
      await servicio.compensarVentaPagada(input(f, 0)),
      await servicio.compensarVentaPagada(input(f, 1)),
    ];
    assert.equal(primero.resultado, "CREADO");
    assert.deepEqual(resultados.map((resultado) => resultado.resultado), ["YA_EXISTENTE", "CREADO"]);
    assert.equal(await cantidadStock(f.lineas[0]!.variante_sku_id, f.lineas[0]!.deposito_id), stockCompletado);
    assert.equal(await prisma.reintegroStockCompensacion.count({
      where: { reintegro_id: f.reintegro.id, movimiento_stock_id: { not: null }, completed_at: { not: null } },
    }), 2);
  });

  await t.test("rechaza item ajeno", async () => {
    const f = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    const otro = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    await prisma.reintegroStockCompensacion.update({
      where: { id: f.lineas[0]!.compensacion.id },
      data: { pedido_venta_item_id: otro.lineas[0]!.item.id },
    });
    await rechazaCon("COMPENSACION_ITEM_INCOMPATIBLE", () => servicio.compensarVentaPagada(input(f)));
  });

  await t.test("rechaza SKU incoherente", async () => {
    const f = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    await prisma.reintegroStockCompensacion.update({
      where: { id: f.lineas[0]!.compensacion.id },
      data: { variante_sku_id: SKU_B_ID },
    });
    await rechazaCon("COMPENSACION_SKU_INCOMPATIBLE", () => servicio.compensarVentaPagada(input(f)));
  });

  await t.test("rechaza depósito incoherente", async () => {
    const f = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    await prisma.reintegroStockCompensacion.update({
      where: { id: f.lineas[0]!.compensacion.id },
      data: { deposito_id: DEPOSITO_SHOWROOM_ID },
    });
    await rechazaCon("COMPENSACION_DEPOSITO_INCOMPATIBLE", () => servicio.compensarVentaPagada(input(f)));
  });

  await t.test("rechaza cantidad cero o mayor a la vendida", async () => {
    const cero = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    await prisma.reintegroStockCompensacion.update({ where: { id: cero.lineas[0]!.compensacion.id }, data: { cantidad: 0 } });
    await rechazaCon("COMPENSACION_CANTIDAD_INVALIDA", () => servicio.compensarVentaPagada(input(cero)));
    const excedida = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    await prisma.reintegroStockCompensacion.update({ where: { id: excedida.lineas[0]!.compensacion.id }, data: { cantidad: 2 } });
    await rechazaCon("COMPENSACION_CANTIDAD_INVALIDA", () => servicio.compensarVentaPagada(input(excedida)));
  });

  await t.test("rechaza reintegro ajeno", async () => {
    const f = await fixture([{ variante_sku_id: SKU_A_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    const otro = await fixture([{ variante_sku_id: SKU_B_ID, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: 1 }]);
    await rechazaCon("COMPENSACION_REINTEGRO_INCOMPATIBLE", () => servicio.compensarVentaPagada({
      ...input(f), reintegro_id: otro.reintegro.id,
    }));
  });

  await t.test("rechaza movimiento previo incompatible sin tocar stock", async () => {
    const f = await fixture([{ variante_sku_id: SKU_C_ID, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: 1 }]);
    const linea = f.lineas[0]!;
    const stockAntes = await cantidadStock(linea.variante_sku_id, linea.deposito_id);
    const incompatible = await prisma.movimientoStock.create({
      data: {
        deposito_destino_id: linea.deposito_id,
        tipo_movimiento: "AJUSTE",
        comprobante_referencia: linea.compensacion.clave_idempotencia,
        registrado_por_id: actor.id,
        venta_id: f.pedido.id,
        items: { create: { variante_sku_id: linea.variante_sku_id, cantidad: 1, estado_origen: "DEVUELTO", estado_destino: "DISPONIBLE" } },
      },
    });
    await prisma.reintegroStockCompensacion.update({
      where: { id: linea.compensacion.id },
      data: { movimiento_stock_id: incompatible.id, completed_at: new Date() },
    });
    await rechazaCon("COMPENSACION_MOVIMIENTO_INCOMPATIBLE", () => servicio.compensarVentaPagada(input(f)));
    assert.equal(await cantidadStock(linea.variante_sku_id, linea.deposito_id), stockAntes);
  });
});
