import assert from "node:assert/strict";
import test from "node:test";
import { EstadoEcommerce } from "@prisma/client";

const DATABASE_URL = process.env.HU_E12_PICK_PACK_INTEGRATION_DATABASE_URL;

test(
  "HU-E12 — admisión a cola Pick&Pack contra PostgreSQL aislado",
  { skip: !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, { admitirPedidoPagoConfirmado }, { ServiceError }] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./pick-pack.service.ts"),
      import("../../errors/service-error.ts"),
    ]);

    t.after(async () => {
      await prisma.$disconnect();
    });

    let operadorId: string;
    let clienteId: string;
    let varianteSkuId: string;

    async function fixtureBase() {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const proveedor = await prisma.proveedor.create({
        data: {
          razon_social: "Proveedor Test PickPack",
          cuit: `30-${suffix}`,
          estado: "HOMOLOGADO",
        },
        select: { id: true },
      });

      const producto = await prisma.productoMaestro.create({
        data: {
          codigo_producto: `PPTST-${suffix}`,
          nombre: "Producto Test PickPack",
          rubro: "Test",
          categoria: "Test",
          unidad_medida: "UNIDAD",
          costo_estandar_referencia: 1000,
        },
        select: { id: true },
      });

      const variante = await prisma.varianteSKU.create({
        data: {
          producto_maestro_id: producto.id,
          sku: `PPTST-M-NEGRO-H-${suffix}`,
          talle: "M",
          color: "NEGRO",
          genero: "HOMBRE",
          modelo: "TEST",
          proveedor_id: proveedor.id,
        },
        select: { id: true },
      });
      varianteSkuId = variante.id;

      const usuario = await prisma.usuario.create({
        data: {
          nombre_usuario: `operador.pickpack.${suffix}`,
          email: `operador.pickpack.${suffix}@test.local`,
          password_hash: "x",
          password_salt: "x",
          nombre_completo: "Operador Test",
          estado: "ACTIVO",
        },
        select: { id: true },
      });
      operadorId = usuario.id;

      const cliente = await prisma.cliente.create({
        data: { dni: `12345${Date.now()}`, nombre: "Cliente Test" },
        select: { id: true },
      });
      clienteId = cliente.id;
    }

    async function crearPedidoWeb(
      overrides: Partial<{
        canal: "WEB" | "MOSTRADOR";
        estado_ecommerce: string;
        fecha_pago: Date | null;
        conExtension: boolean;
        conItems: boolean;
      }> = {},
    ) {
      const numero = `V-E12-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pedido = await prisma.pedidoVenta.create({
        data: {
          numero_venta: numero,
          cliente_id: clienteId,
          canal: overrides.canal ?? "WEB",
          estado: "FACTURADO",
          total: 1000,
          registrado_por_id: operadorId,
        },
        select: { id: true, numero_venta: true },
      });

      if (overrides.conExtension !== false) {
        await prisma.pedidoVentaEcommerce.create({
          data: {
            pedido_venta_id: pedido.id,
            estado_ecommerce:
              (overrides.estado_ecommerce as EstadoEcommerce | undefined) ?? "PAGO_CONFIRMADO",
            fecha_pago_confirmado:
              overrides.fecha_pago === null ? null : (overrides.fecha_pago ?? new Date()),
          },
          select: { id: true },
        });
      }

      if (overrides.conItems !== false) {
        await prisma.pedidoVentaItem.create({
          data: {
            pedido_venta_id: pedido.id,
            variante_sku_id: varianteSkuId,
            cantidad: 1,
            precio_unitario: 1000,
            cantidad_facturada: 1,
          },
        });
      }

      return pedido.id;
    }

    await fixtureBase();

    await t.test("admite PAGO_CONFIRMADO en cola sin iniciar preparación", async () => {
      const pedidoId = await crearPedidoWeb({ estado_ecommerce: "PAGO_CONFIRMADO", fecha_pago: new Date() });
      const resultado = await prisma.$transaction(async (tx) =>
        admitirPedidoPagoConfirmado(tx, pedidoId),
      );
      assert.equal(resultado.transicion_realizada, true);
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "PAGO_CONFIRMADO");
      assert.equal(ext?.operador_asignado_id, null);
      assert.equal(resultado.evento_pendiente?.payload.estado_nuevo, "PAGO_CONFIRMADO");
    });

    await t.test("repetición conserva el evento lógico estable y PAGO_CONFIRMADO", async () => {
      const pedidoId = await crearPedidoWeb({ estado_ecommerce: "PAGO_CONFIRMADO", fecha_pago: new Date() });
      const r1 = await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      const r2 = await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      assert.equal(r1.evento_pendiente?.payload.evento_id, r2.evento_pendiente?.payload.evento_id);
      assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: pedidoId },
      })).estado_ecommerce, "PAGO_CONFIRMADO");
    });

    await t.test("no reinterpreta un pedido legacy EN_PREPARACION", async () => {
      const pedidoId = await crearPedidoWeb({ estado_ecommerce: "EN_PREPARACION", fecha_pago: new Date() });
      await assert.rejects(
        () => prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId)),
        (error: unknown) => error instanceof ServiceError && error.code === "PEDIDO_NO_ADMITIBLE",
      );
      assert.equal((await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: pedidoId },
      })).estado_ecommerce, "EN_PREPARACION");
    });

    await t.test("rechaza PAGO_CONFIRMADO sin fecha_pago_confirmado", async () => {
      const pedidoId = await crearPedidoWeb({ estado_ecommerce: "PAGO_CONFIRMADO", fecha_pago: null });
      let error: unknown;
      try {
        await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_SIN_FECHA_PAGO");
    });

    await t.test("rechaza pedido MOSTRADOR", async () => {
      const pedidoId = await crearPedidoWeb({ canal: "MOSTRADOR", estado_ecommerce: "PAGO_CONFIRMADO", fecha_pago: new Date() });
      let error: unknown;
      try {
        await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_OPERABLE");
    });

    await t.test("rechaza extensión inexistente/inactiva", async () => {
      const pedidoId = await crearPedidoWeb({ conExtension: false });
      let error: unknown;
      try {
        await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_OPERABLE");
    });

    await t.test("rechaza estado posterior a PAGO_CONFIRMADO", async () => {
      const pedidoId = await crearPedidoWeb({ estado_ecommerce: "LISTO_PARA_RETIRO", fecha_pago: new Date() });
      let error: unknown;
      try {
        await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_ADMITIBLE");
    });

    await t.test("rollback externo de la transacción caller revierte la admisión", async () => {
      const pedidoId = await crearPedidoWeb({ estado_ecommerce: "PAGO_CONFIRMADO", fecha_pago: new Date() });
      let error: unknown;
      try {
        await prisma.$transaction(async (tx) => {
          await admitirPedidoPagoConfirmado(tx, pedidoId);
          throw new Error("rollback forzado");
        });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof Error);
      assert.match((error as Error).message, /rollback forzado/);
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "PAGO_CONFIRMADO");
    });
  },
);
