import assert from "node:assert/strict";
import test from "node:test";
import { EstadoEcommerce } from "@prisma/client";

const DATABASE_URL = process.env.HU_E12_PICK_PACK_INTEGRATION_DATABASE_URL;

test(
  "HU-E12 — cola, toma y prioridad Pick&Pack contra PostgreSQL aislado",
  { skip: !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const CLAVE_PLAZO_RETIRO = "ECOMMERCE_PLAZO_RETIRO_DIAS";

    const [
      { prisma },
      {
        listarColaPreparacion,
        tomarPedido,
        actualizarPrioridad,
        confirmarItem,
        completarPreparacion,
      },
      { ServiceError },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./pick-pack.service.ts"),
      import("../../errors/service-error.ts"),
    ]);

    t.after(async () => {
      await prisma.$disconnect();
    });

    let adminId: string;
    let operador1Id: string;
    let operador2Id: string;
    let clienteId: string;
    let varianteSkuId: string;
    let varianteSkuSku: string;
    let varianteSkuAjenaSku: string;

    async function fixtureBase() {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const proveedor = await prisma.proveedor.create({
        data: { razon_social: "Proveedor Test PickPack", cuit: `30-${suffix}`, estado: "HOMOLOGADO" },
        select: { id: true },
      });

      const producto = await prisma.productoMaestro.create({
        data: {
          codigo_producto: `PPE12-${suffix}`,
          nombre: "Producto E12",
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
          sku: `PPE12-L-AZUL-H-${suffix}`,
          talle: "L",
          color: "AZUL",
          genero: "HOMBRE",
          modelo: "TEST",
          proveedor_id: proveedor.id,
        },
        select: { id: true, sku: true },
      });
      varianteSkuId = variante.id;
      varianteSkuSku = variante.sku;

      const varianteAjena = await prisma.varianteSKU.create({
        data: {
          producto_maestro_id: producto.id,
          sku: `PPE12-M-ROJO-M-${suffix}`,
          talle: "M",
          color: "ROJO",
          genero: "HOMBRE",
          modelo: "TEST",
          proveedor_id: proveedor.id,
        },
        select: { id: true, sku: true },
      });
      varianteSkuAjenaSku = varianteAjena.sku;

      adminId = (await prisma.usuario.create({
        data: {
          nombre_usuario: `admin.e12.${suffix}`,
          email: `admin.e12.${suffix}@test.local`,
          password_hash: "x",
          password_salt: "x",
          nombre_completo: "Admin E12",
          estado: "ACTIVO",
        },
        select: { id: true },
      })).id;

      operador1Id = (await prisma.usuario.create({
        data: {
          nombre_usuario: `op1.e12.${suffix}`,
          email: `op1.e12.${suffix}@test.local`,
          password_hash: "x",
          password_salt: "x",
          nombre_completo: "Operador 1",
          estado: "ACTIVO",
        },
        select: { id: true },
      })).id;

      operador2Id = (await prisma.usuario.create({
        data: {
          nombre_usuario: `op2.e12.${suffix}`,
          email: `op2.e12.${suffix}@test.local`,
          password_hash: "x",
          password_salt: "x",
          nombre_completo: "Operador 2",
          estado: "ACTIVO",
        },
        select: { id: true },
      })).id;

      clienteId = (await prisma.cliente.create({
        data: { dni: `99999${Date.now()}`, nombre: "Cliente E12" },
        select: { id: true },
      })).id;
    }

    async function crearPedidoEnPreparacion(overrides: {
      prioridad?: number | null;
      fecha_pago?: Date | null;
      operador_asignado_id?: string | null;
      cantidad?: number;
      escaneos?: number;
      estado_ecommerce?: string;
      canal?: "WEB" | "MOSTRADOR";
    } = {}) {
      const numero = `V-E12-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pedido = await prisma.pedidoVenta.create({
        data: {
          numero_venta: numero,
          cliente_id: clienteId,
          canal: overrides.canal ?? "WEB",
          estado: "FACTURADO",
          total: 1000,
          registrado_por_id: adminId,
        },
        select: { id: true },
      });

      const ext = await prisma.pedidoVentaEcommerce.create({
        data: {
          pedido_venta_id: pedido.id,
          estado_ecommerce:
            (overrides.estado_ecommerce as EstadoEcommerce | undefined) ?? "EN_PREPARACION",
          fecha_pago_confirmado:
            overrides.fecha_pago === null ? null : (overrides.fecha_pago ?? new Date("2026-10-01T12:00:00Z")),
          prioridad_manual: overrides.prioridad ?? null,
          operador_asignado_id: overrides.operador_asignado_id ?? null,
        },
        select: { id: true },
      });

      const cantidad = overrides.cantidad ?? 1;
      for (let i = 0; i < cantidad; i++) {
        const item = await prisma.pedidoVentaItem.create({
          data: {
            pedido_venta_id: pedido.id,
            variante_sku_id: varianteSkuId,
            cantidad: 1,
            precio_unitario: 1000,
            cantidad_facturada: 1,
          },
        });

        const escaneos = overrides.escaneos ?? 0;
        for (let e = 0; e < escaneos && i === 0; e++) {
          await prisma.pedidoPreparacionEscaneo.create({
            data: {
              pedido_venta_item_id: item.id,
              operador_id: operador1Id,
              scan_id: crypto.randomUUID(),
              codigo_escaneado: "7791234567890",
            },
          });
        }
      }

      return { pedidoId: pedido.id, extId: ext.id };
    }

    await fixtureBase();

    await t.test("cola: orden contractual y paginación", async () => {
      await crearPedidoEnPreparacion({ prioridad: 10, fecha_pago: new Date("2026-10-01T10:00:00Z") });
      await crearPedidoEnPreparacion({ prioridad: 10, fecha_pago: new Date("2026-10-01T09:00:00Z") });
      await crearPedidoEnPreparacion({ prioridad: null, fecha_pago: new Date("2026-10-01T08:00:00Z") });
      const legacy = await crearPedidoEnPreparacion({ prioridad: 10, fecha_pago: null });
      await crearPedidoEnPreparacion({
        prioridad: 5,
        fecha_pago: new Date("2026-10-01T07:00:00Z"),
        escaneos: 1,
      });

      const primera = await listarColaPreparacion({ page: 1, page_size: 2 });
      assert.equal(primera.total >= 5, true);
      assert.equal(primera.items.length, 2);
      assert.equal(primera.items[0].prioridad_manual, 10);
      assert.equal(primera.items[1].prioridad_manual, 10);
      // Igual prioridad: fecha más temprana primero.
      assert.ok(
        (primera.items[0].fecha_pago_confirmado?.getTime() ?? 0) <=
          (primera.items[1].fecha_pago_confirmado?.getTime() ?? 0),
      );

      const segunda = await listarColaPreparacion({ page: 2, page_size: 2 });
      assert.equal(segunda.items.length, 2);

      const colaCompleta = await listarColaPreparacion({ page: 1, page_size: 100 });
      const ids = colaCompleta.items.map((i) => i.pedido_venta_id);
      assert.equal(new Set(ids).size, ids.length);
      // El legacy con fecha null debe estar dentro de su grupo de prioridad, después de los que tienen fecha.
      const legacyItem = colaCompleta.items.find((i) => i.pedido_venta_id === legacy.pedidoId);
      assert.ok(legacyItem);
      assert.equal(legacyItem?.fecha_pago_confirmado, null);
    });

    await t.test("cola: excluye no-WEB y otros estados", async () => {
      const mostrador = await crearPedidoEnPreparacion({ canal: "MOSTRADOR" });
      const pendiente = await crearPedidoEnPreparacion({ estado_ecommerce: "PAGO_PENDIENTE" });
      const listo = await crearPedidoEnPreparacion({ estado_ecommerce: "LISTO_PARA_RETIRO" });

      const cola = await listarColaPreparacion({ page: 1, page_size: 1000 });
      const ids = cola.items.map((i) => i.pedido_venta_id);
      assert.ok(!ids.includes(mostrador.pedidoId));
      assert.ok(!ids.includes(pendiente.pedidoId));
      assert.ok(!ids.includes(listo.pedidoId));
    });

    await t.test("cola: progreso derivado de escaneos activos", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ cantidad: 1, escaneos: 1 });
      const cola = await listarColaPreparacion({ page: 1, page_size: 1000 });
      const item = cola.items.find((i) => i.pedido_venta_id === pedidoId);
      assert.ok(item);
      assert.equal(item?.lineas[0]?.cantidad_confirmada, 1);
      assert.equal(item?.progreso.porcentaje, 100);
      assert.equal(item?.progreso.completo, true);
    });

    await t.test("tomar: libre → asignado; no cambia estado", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion();
      const r = await tomarPedido(pedidoId, operador1Id);
      assert.equal(r.cambio_realizado, true);
      assert.equal(r.operador_asignado_id, operador1Id);
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.operador_asignado_id, operador1Id);
      assert.equal(ext?.estado_ecommerce, "EN_PREPARACION");
    });

    await t.test("tomar: mismo actor → idempotente", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion();
      await tomarPedido(pedidoId, operador1Id);
      const r = await tomarPedido(pedidoId, operador1Id);
      assert.equal(r.cambio_realizado, false);
    });

    await t.test("tomar: otro actor → conflicto", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion();
      await tomarPedido(pedidoId, operador1Id);
      let error: unknown;
      try {
        await tomarPedido(pedidoId, operador2Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_YA_TOMADO");
    });

    await t.test("tomar: estado inválido → error", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ estado_ecommerce: "PAGO_CONFIRMADO" });
      let error: unknown;
      try {
        await tomarPedido(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "ESTADO_INVALIDO");
    });

    await t.test("tomar: no WEB → error", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ canal: "MOSTRADOR" });
      let error: unknown;
      try {
        await tomarPedido(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_OPERABLE");
    });

    await t.test("prioridad: cambia, quita e idempotente", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ prioridad: 5 });
      const r1 = await actualizarPrioridad(pedidoId, adminId, 10);
      assert.equal(r1.cambio_realizado, true);
      assert.equal(r1.prioridad_anterior, 5);

      const r2 = await actualizarPrioridad(pedidoId, adminId, null);
      assert.equal(r2.cambio_realizado, true);
      assert.equal(r2.prioridad_anterior, 10);
      assert.equal(r2.prioridad_manual, null);

      const r3 = await actualizarPrioridad(pedidoId, adminId, null);
      assert.equal(r3.cambio_realizado, false);
    });

    await t.test("prioridad: pedido tomado → rechazado", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion();
      await tomarPedido(pedidoId, operador1Id);
      let error: unknown;
      try {
        await actualizarPrioridad(pedidoId, adminId, 99);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_TOMADO_NO_PRIORIZABLE");
    });

    // ── Escaneo / T05 ────────────────────────────────────────────────────────

    async function pedidoTomado(overrides: Parameters<typeof crearPedidoEnPreparacion>[0] = {}) {
      const { pedidoId } = await crearPedidoEnPreparacion(overrides);
      await tomarPedido(pedidoId, operador1Id);
      return pedidoId;
    }

    async function configurarPlazoRetiro(valor: string) {
      await prisma.configuracionSistema.upsert({
        where: { clave: CLAVE_PLAZO_RETIRO },
        update: { valor },
        create: {
          clave: CLAVE_PLAZO_RETIRO,
          valor,
          descripcion: "Días de plazo para retiro Click & Collect",
          modulo: "E",
          actualizado_por_id: adminId,
        },
      });
    }

    async function pedidoPreparadoCompleto({
      cantidadLineas = 1,
      cantidades,
    }: { cantidadLineas?: number; cantidades?: number[] } = {}) {
      await configurarPlazoRetiro("10");
      const pedidoId = await pedidoTomado({ cantidad: cantidadLineas });
      const items = await prisma.pedidoVentaItem.findMany({
        where: { pedido_venta_id: pedidoId },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
      });
      for (let i = 0; i < items.length; i++) {
        const qty = cantidades?.[i] ?? 1;
        if (qty !== 1) {
          await prisma.pedidoVentaItem.update({
            where: { id: items[i].id },
            data: { cantidad: qty },
          });
        }
        for (let j = 0; j < qty; j++) {
          await confirmarItem(pedidoId, operador1Id, {
            scan_id: crypto.randomUUID(),
            codigo: varianteSkuSku,
          });
        }
      }
      return pedidoId;
    }

    await t.test("escaneo: código SKU válido → acredita unidad", async () => {
      const pedidoId = await pedidoTomado();
      const scanId = crypto.randomUUID();
      const r = await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      assert.equal(r.cambio_realizado, true);
      assert.equal(r.idempotente, false);
      assert.equal(r.scan_id, scanId);
      assert.equal(r.progreso.total_confirmado, 1);
      assert.equal(r.progreso.completo, true);
    });

    await t.test("escaneo: código EAN válido → acredita unidad", async () => {
      const ean = `EAN-${Date.now()}`;
      await prisma.varianteSKU.update({ where: { id: varianteSkuId }, data: { ean_qr: ean } });
      const pedidoId = await pedidoTomado();
      const r = await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: ean });
      assert.equal(r.cambio_realizado, true);
      assert.equal(r.progreso.total_confirmado, 1);
    });

    await t.test("escaneo: código ajeno al pedido → rechazado", async () => {
      const pedidoId = await pedidoTomado();
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuAjenaSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "CODIGO_NO_PERTENECE_PEDIDO");
    });

    await t.test("escaneo: actor incorrecto → rechazado", async () => {
      const pedidoId = await pedidoTomado();
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador2Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "OPERADOR_NO_AUTORIZADO");
    });

    await t.test("escaneo: pedido sin operador → rechazado", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion();
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_ASIGNADO");
    });

    await t.test("escaneo: estado distinto de EN_PREPARACION → rechazado", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ estado_ecommerce: "PAGO_CONFIRMADO" });
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "ESTADO_INVALIDO");
    });

    await t.test("escaneo: mismo scan_id + mismo payload → idempotente", async () => {
      const pedidoId = await pedidoTomado();
      const scanId = crypto.randomUUID();
      const r1 = await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      const r2 = await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      assert.equal(r1.cambio_realizado, true);
      assert.equal(r2.cambio_realizado, false);
      assert.equal(r2.idempotente, true);
      const count = await prisma.pedidoPreparacionEscaneo.count({ where: { scan_id: scanId } });
      assert.equal(count, 1);
    });

    await t.test("escaneo: scan_id mismo + código distinto → conflicto", async () => {
      const pedidoId = await pedidoTomado();
      const scanId = crypto.randomUUID();
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: `${varianteSkuSku}-x` });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "SCAN_ID_CONFLICTO");
    });

    await t.test("escaneo: scan_id usado en otro pedido → conflicto", async () => {
      const pedido1 = await pedidoTomado();
      const pedido2 = await pedidoTomado();
      const scanId = crypto.randomUUID();
      await confirmarItem(pedido1, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      let error: unknown;
      try {
        await confirmarItem(pedido2, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "SCAN_ID_CONFLICTO");
    });

    await t.test("escaneo: dos scan_id distintos acreditan dos unidades iguales", async () => {
      const pedidoId = await pedidoTomado({ cantidad: 2 });
      const scan1 = crypto.randomUUID();
      const scan2 = crypto.randomUUID();
      const r1 = await confirmarItem(pedidoId, operador1Id, { scan_id: scan1, codigo: varianteSkuSku });
      const r2 = await confirmarItem(pedidoId, operador1Id, { scan_id: scan2, codigo: varianteSkuSku });
      assert.notEqual(r1.pedido_venta_item_id, r2.pedido_venta_item_id);
      assert.equal(r1.cantidad_confirmada, 1);
      assert.equal(r2.cantidad_confirmada, 1);
      assert.equal(r1.progreso.total_confirmado, 1);
      assert.equal(r2.progreso.total_confirmado, 2);
      assert.equal(r2.progreso.completo, true);
    });

    await t.test("escaneo: cantidad excedida → CANTIDAD_YA_COMPLETA", async () => {
      const pedidoId = await pedidoTomado();
      await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "CANTIDAD_YA_COMPLETA");
    });

    await t.test("escaneo: mismo SKU en dos líneas elige la primera pendiente", async () => {
      const pedidoId = await pedidoTomado({ cantidad: 2 });
      const items = await prisma.pedidoVentaItem.findMany({
        where: { pedido_venta_id: pedidoId },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
      });
      const r = await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      assert.equal(r.pedido_venta_item_id, items[0].id);
      const r2 = await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      assert.equal(r2.pedido_venta_item_id, items[1].id);
    });

    await t.test("escaneo: inactivo no cuenta para progreso", async () => {
      const pedidoId = await pedidoTomado();
      const scanId = crypto.randomUUID();
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      await prisma.pedidoPreparacionEscaneo.updateMany({
        where: { scan_id: scanId },
        data: { is_active: false, deleted_at: new Date() },
      });
      const r = await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      assert.equal(r.progreso.total_confirmado, 1);
      assert.equal(r.cambio_realizado, true);
    });

    await t.test("escaneo: scan_id de escaneo inactivo no puede reutilizarse", async () => {
      const pedidoId = await pedidoTomado();
      const scanId = crypto.randomUUID();
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      await prisma.pedidoPreparacionEscaneo.updateMany({
        where: { scan_id: scanId },
        data: { is_active: false, deleted_at: new Date() },
      });
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "SCAN_ID_CONFLICTO");
    });

    await t.test("escaneo: retry con mismo scan_id después de cambio de estado → idempotente", async () => {
      const pedidoId = await pedidoTomado();
      const scanId = crypto.randomUUID();
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      await prisma.pedidoVentaEcommerce.update({
        where: { pedido_venta_id: pedidoId },
        data: { estado_ecommerce: "LISTO_PARA_RETIRO" },
      });
      const r = await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      assert.equal(r.idempotente, true);
      assert.equal(r.cambio_realizado, false);
      assert.equal(r.progreso.total_confirmado, 1);
    });

    await t.test("escaneo: lectura nueva en estado posterior → rechazada", async () => {
      const pedidoId = await pedidoTomado();
      await prisma.pedidoVentaEcommerce.update({
        where: { pedido_venta_id: pedidoId },
        data: { estado_ecommerce: "LISTO_PARA_RETIRO" },
      });
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "ESTADO_INVALIDO");
    });

    await t.test("concurrencia escaneo: último cupo, exactamente uno inserta", async () => {
      const pedidoId = await pedidoTomado();
      const scanA = crypto.randomUUID();
      const scanB = crypto.randomUUID();
      const [rA, rB] = await Promise.allSettled([
        confirmarItem(pedidoId, operador1Id, { scan_id: scanA, codigo: varianteSkuSku }),
        confirmarItem(pedidoId, operador1Id, { scan_id: scanB, codigo: varianteSkuSku }),
      ]);

      const exitosos = [rA, rB].filter((r) => r.status === "fulfilled");
      const fallidos = [rA, rB].filter((r) => r.status === "rejected");
      assert.equal(exitosos.length, 1);
      assert.equal(fallidos.length, 1);

      const activos = await prisma.pedidoPreparacionEscaneo.count({
        where: {
          pedido_venta_item: { pedido_venta_id: pedidoId },
          is_active: true,
          deleted_at: null,
        },
      });
      assert.equal(activos, 1);
    });

    await t.test("concurrencia escaneo: retry mismo scan_id sin doble progreso", async () => {
      const pedidoId = await pedidoTomado({ cantidad: 2 });
      const scanId = crypto.randomUUID();
      const [rA, rB] = await Promise.allSettled([
        confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku }),
        confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku }),
      ]);

      assert.equal(rA.status, "fulfilled");
      assert.equal(rB.status, "fulfilled");

      const cumplidos = [rA, rB].filter(
        (r) => r.status === "fulfilled" && r.value.cambio_realizado,
      ).length;
      const idempotentes = [rA, rB].filter(
        (r) => r.status === "fulfilled" && r.value.idempotente,
      ).length;
      assert.equal(cumplidos, 1);
      assert.equal(idempotentes, 1);

      const activos = await prisma.pedidoPreparacionEscaneo.count({
        where: {
          scan_id: scanId,
          is_active: true,
          deleted_at: null,
        },
      });
      assert.equal(activos, 1);
    });

    // ── Completar preparación / T06 ───────────────────────────────────────

    await t.test("completar: pedido completo → LISTO_PARA_RETIRO", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      const r = await completarPreparacion(pedidoId, operador1Id);
      assert.equal(r.cambio_realizado, true);
      assert.equal(r.idempotente, false);
      assert.equal(r.estado_ecommerce, "LISTO_PARA_RETIRO");
      assert.equal(r.progreso.completo, true);
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "LISTO_PARA_RETIRO");
      assert.ok(ext?.codigo_qr_retiro);
      assert.ok(ext?.plazo_retiro_vencimiento);
    });

    await t.test("completar: línea incompleta → PREPARACION_INCOMPLETA", async () => {
      const pedidoId = await pedidoTomado();
      const items = await prisma.pedidoVentaItem.findMany({ where: { pedido_venta_id: pedidoId } });
      await prisma.pedidoVentaItem.update({ where: { id: items[0].id }, data: { cantidad: 2 } });
      await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PREPARACION_INCOMPLETA");
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "EN_PREPARACION");
    });

    await t.test("completar: varias líneas todas completas → LISTO", async () => {
      const pedidoId = await pedidoPreparadoCompleto({ cantidadLineas: 2, cantidades: [1, 2] });
      const r = await completarPreparacion(pedidoId, operador1Id);
      assert.equal(r.cambio_realizado, true);
      assert.equal(r.progreso.total_requerido, 3);
      assert.equal(r.progreso.total_confirmado, 3);
      assert.equal(r.progreso.completo, true);
    });

    await t.test("completar: pedido sin líneas activas → rechazo", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ cantidad: 0 });
      await tomarPedido(pedidoId, operador1Id);
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_OPERABLE");
    });

    await t.test("completar: operador incorrecto → rechazo", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador2Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "OPERADOR_NO_AUTORIZADO");
    });

    await t.test("completar: pedido sin operador → rechazo", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion();
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_ASIGNADO");
    });

    await t.test("completar: pedido no WEB → rechazo", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ canal: "MOSTRADOR" });
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PEDIDO_NO_OPERABLE");
    });

    await t.test("completar: estado distinto de EN_PREPARACION → rechazo", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion({ estado_ecommerce: "PAGO_CONFIRMADO" });
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "ESTADO_INVALIDO");
    });

    await t.test("completar: configuración inválida → rollback", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      await configurarPlazoRetiro("10abc");
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "CONFIGURACION_INVALIDA");
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "EN_PREPARACION");
      assert.equal(ext?.codigo_qr_retiro, null);
      assert.equal(ext?.plazo_retiro_vencimiento, null);
    });

    await t.test("completar: config 0 → inválida", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      await configurarPlazoRetiro("0");
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "CONFIGURACION_INVALIDA");
    });

    await t.test("completar: config negativa → inválida", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      await configurarPlazoRetiro("-5");
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "CONFIGURACION_INVALIDA");
    });

    await t.test("completar: config decimal → inválida", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      await configurarPlazoRetiro("10.5");
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "CONFIGURACION_INVALIDA");
    });

    await t.test("completar: token QR representa 32 bytes", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      await completarPreparacion(pedidoId, operador1Id);
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      const token = ext?.codigo_qr_retiro ?? "";
      const decoded = Buffer.from(token, "base64url");
      assert.equal(decoded.length, 32);
    });

    await t.test("completar: dos pedidos generan tokens diferentes", async () => {
      const pedido1 = await pedidoPreparadoCompleto();
      const pedido2 = await pedidoPreparadoCompleto();
      await completarPreparacion(pedido1, operador1Id);
      await completarPreparacion(pedido2, operador1Id);
      const ext1 = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedido1 } });
      const ext2 = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedido2 } });
      assert.notEqual(ext1?.codigo_qr_retiro, ext2?.codigo_qr_retiro);
    });

    await t.test("completar: DTO no expone el token QR", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      const r = await completarPreparacion(pedidoId, operador1Id);
      assert.ok(!((r as unknown as Record<string, unknown>).codigo_qr_retiro));
    });

    await t.test("completar: doble completar es idempotente y conserva token/plazo", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      const r1 = await completarPreparacion(pedidoId, operador1Id);
      const ext1 = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      await configurarPlazoRetiro("99");
      const r2 = await completarPreparacion(pedidoId, operador1Id);
      const ext2 = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(r1.cambio_realizado, true);
      assert.equal(r2.cambio_realizado, false);
      assert.equal(r2.idempotente, true);
      assert.equal(ext2?.codigo_qr_retiro, ext1?.codigo_qr_retiro);
      assert.equal(ext2?.plazo_retiro_vencimiento?.getTime(), ext1?.plazo_retiro_vencimiento?.getTime());
    });

    await t.test("completar: LISTO inconsistente sin token/plazo → error", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      await completarPreparacion(pedidoId, operador1Id);
      await prisma.pedidoVentaEcommerce.update({
        where: { pedido_venta_id: pedidoId },
        data: { codigo_qr_retiro: null },
      });
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "ESTADO_INCONSISTENTE");
    });

    await t.test("completar: carrera scan primero gana, luego completa", async () => {
      const pedidoId = await pedidoTomado();
      const item = await prisma.pedidoVentaItem.findFirst({ where: { pedido_venta_id: pedidoId } });
      await prisma.pedidoVentaItem.update({ where: { id: item?.id }, data: { cantidad: 1 } });
      await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      const r = await completarPreparacion(pedidoId, operador1Id);
      assert.equal(r.cambio_realizado, true);
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "LISTO_PARA_RETIRO");
      const activos = await prisma.pedidoPreparacionEscaneo.count({
        where: { pedido_venta_item: { pedido_venta_id: pedidoId }, is_active: true },
      });
      assert.equal(activos, 1);
    });

    await t.test("completar: carrera completar primero ve incompleto, luego scan y completa", async () => {
      const pedidoId = await pedidoTomado();
      const item = await prisma.pedidoVentaItem.findFirst({ where: { pedido_venta_id: pedidoId } });
      await prisma.pedidoVentaItem.update({ where: { id: item?.id }, data: { cantidad: 1 } });
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "PREPARACION_INCOMPLETA");
      await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      const r = await completarPreparacion(pedidoId, operador1Id);
      assert.equal(r.cambio_realizado, true);
      assert.equal(r.estado_ecommerce, "LISTO_PARA_RETIRO");
    });

    await t.test("completar: doble completar concurrente → una transición y una idempotente", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      const [rA, rB] = await Promise.allSettled([
        completarPreparacion(pedidoId, operador1Id),
        completarPreparacion(pedidoId, operador1Id),
      ]);
      assert.equal(rA.status, "fulfilled");
      assert.equal(rB.status, "fulfilled");
      const cumplidos = [rA, rB].filter((r) => r.status === "fulfilled" && r.value.cambio_realizado).length;
      const idempotentes = [rA, rB].filter((r) => r.status === "fulfilled" && r.value.idempotente).length;
      assert.equal(cumplidos, 1);
      assert.equal(idempotentes, 1);
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "LISTO_PARA_RETIRO");
      assert.ok(ext?.codigo_qr_retiro);
      assert.ok(ext?.plazo_retiro_vencimiento);
    });

    await t.test("completar: rollback config inválida no altera estado ni scans", async () => {
      const pedidoId = await pedidoPreparadoCompleto();
      await configurarPlazoRetiro("");
      let error: unknown;
      try {
        await completarPreparacion(pedidoId, operador1Id);
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "CONFIGURACION_INVALIDA");
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.estado_ecommerce, "EN_PREPARACION");
      assert.equal(ext?.codigo_qr_retiro, null);
      assert.equal(ext?.plazo_retiro_vencimiento, null);
      const activos = await prisma.pedidoPreparacionEscaneo.count({
        where: { pedido_venta_item: { pedido_venta_id: pedidoId }, is_active: true },
      });
      assert.equal(activos, 1);
    });

    await t.test("completar: regresión T05 — scan existente idempotente tras LISTO, scan nuevo rechazado", async () => {
      const pedidoId = await pedidoTomado();
      const scanId = crypto.randomUUID();
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      await configurarPlazoRetiro("10");
      await completarPreparacion(pedidoId, operador1Id);
      const rRetry = await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      assert.equal(rRetry.idempotente, true);
      let error: unknown;
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      } catch (err) {
        error = err;
      }
      assert.ok(error instanceof ServiceError);
      assert.equal((error as { code: string }).code, "ESTADO_INVALIDO");
    });

    await t.test("concurrencia: dos operadores, exactamente uno toma", async () => {
      const { pedidoId } = await crearPedidoEnPreparacion();
      const [r1, r2] = await Promise.allSettled([
        tomarPedido(pedidoId, operador1Id),
        tomarPedido(pedidoId, operador2Id),
      ]);

      const exitosos = [r1, r2].filter((r) => r.status === "fulfilled");
      const fallidos = [r1, r2].filter((r) => r.status === "rejected");
      assert.equal(exitosos.length, 1);
      assert.equal(fallidos.length, 1);

      const ganador = (exitosos[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof tomarPedido>>>).value;
      const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
      assert.equal(ext?.operador_asignado_id, ganador.operador_asignado_id);
    });
  },
);
