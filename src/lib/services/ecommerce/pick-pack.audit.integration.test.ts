import assert from "node:assert/strict";
import test from "node:test";
import { EstadoEcommerce } from "@prisma/client";

const DATABASE_URL = process.env.HU_E12_PICK_PACK_INTEGRATION_DATABASE_URL;

test(
  "HU-E12 — AuditLog de eventos Pick&Pack contra PostgreSQL aislado",
  { skip: !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      {
        admitirPedidoPagoConfirmado,
        tomarPedido,
        actualizarPrioridad,
        confirmarItem,
        completarPreparacion,
      },
      { domainEventBus },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./pick-pack.service.ts"),
      import("../../events/domain-event-bus.ts"),
    ]);

    const { verificarCadenaIntegridad } = await import("../auditoria/audit-log.service.ts");

    t.after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await prisma.$disconnect();
    });

    let adminId: string;
    let operador1Id: string;
    let clienteId: string;
    let varianteSkuId: string;
    let varianteSkuSku: string;

    async function fixtureBase() {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const proveedor = await prisma.proveedor.create({
        data: { razon_social: "Proveedor Audit E12", cuit: `30-${suffix}`, estado: "HOMOLOGADO" },
        select: { id: true },
      });

      const producto = await prisma.productoMaestro.create({
        data: {
          codigo_producto: `PPE12AUD-${suffix}`,
          nombre: "Producto E12 Audit",
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
          sku: `PPE12AUD-L-AZUL-H-${suffix}`,
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

      adminId = (
        await prisma.usuario.create({
          data: {
            nombre_usuario: `admin.e12aud.${suffix}`,
            email: `admin.e12aud.${suffix}@test.local`,
            password_hash: "x",
            password_salt: "x",
            nombre_completo: "Admin E12",
            estado: "ACTIVO",
          },
          select: { id: true },
        })
      ).id;

      operador1Id = (
        await prisma.usuario.create({
          data: {
            nombre_usuario: `op1.e12aud.${suffix}`,
            email: `op1.e12aud.${suffix}@test.local`,
            password_hash: "x",
            password_salt: "x",
            nombre_completo: "Operador 1",
            estado: "ACTIVO",
          },
          select: { id: true },
        })
      ).id;

      clienteId = (
        await prisma.cliente.create({
          data: { dni: `99999${Date.now()}`, nombre: "Cliente E12" },
          select: { id: true },
        })
      ).id;
    }

    async function crearPedido(
      overrides: {
        estado_ecommerce?: EstadoEcommerce;
        prioridad?: number | null;
        operador_asignado_id?: string | null;
        cantidad?: number;
        escaneos?: number;
      } = {},
    ) {
      const numero = `V-E12AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pedido = await prisma.pedidoVenta.create({
        data: {
          numero_venta: numero,
          cliente_id: clienteId,
          canal: "WEB",
          estado: "FACTURADO",
          total: 1000,
          registrado_por_id: adminId,
        },
        select: { id: true },
      });

      const ext = await prisma.pedidoVentaEcommerce.create({
        data: {
          pedido_venta_id: pedido.id,
          estado_ecommerce: overrides.estado_ecommerce ?? "EN_PREPARACION",
          fecha_pago_confirmado: new Date("2026-10-01T12:00:00Z"),
          prioridad_manual: overrides.prioridad ?? null,
          operador_asignado_id: overrides.operador_asignado_id ?? null,
        },
        select: { id: true },
      });

      const items: { id: string }[] = [];
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
          select: { id: true },
        });
        items.push(item);

        const escaneos = overrides.escaneos ?? 0;
        for (let e = 0; e < escaneos && i === 0; e++) {
          await prisma.pedidoPreparacionEscaneo.create({
            data: {
              pedido_venta_item_id: item.id,
              operador_id: operador1Id,
              scan_id: crypto.randomUUID(),
              codigo_escaneado: varianteSkuSku,
            },
          });
        }
      }

      return { pedidoId: pedido.id, extId: ext.id, items };
    }

    async function configurarPlazoRetiro(valor: string) {
      await prisma.configuracionSistema.upsert({
        where: { clave: "ECOMMERCE_PLAZO_RETIRO_DIAS" },
        update: { valor, actualizado_por_id: adminId },
        create: { clave: "ECOMMERCE_PLAZO_RETIRO_DIAS", valor, modulo: "E", actualizado_por_id: adminId },
      });
    }

    async function esperarAuditLog() {
      // Los listeners de auditoría son fire-and-forget; esperamos hasta que la
      // cantidad de registros se estabilice, no solo un timeout fijo.
      let anterior = -1;
      for (let i = 0; i < 30; i++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) return;
        anterior = actual;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    await fixtureBase();

    await t.test("audit: toma genera asiento con actor y referencia al pedido", async () => {
      const { pedidoId, extId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      await tomarPedido(pedidoId, operador1Id);
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "PEDIDO_TOMADO", registro_id: extId },
        orderBy: { created_at: "desc" },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].usuario_id, operador1Id);
      assert.equal(logs[0].tabla_afectada, "pedidos_venta_ecommerce");
      const valorNuevo = logs[0].valor_nuevo as Record<string, unknown>;
      assert.equal(valorNuevo.estado_ecommerce, "EN_PREPARACION");
      assert.equal((logs[0].valor_anterior as Record<string, unknown> | null)?.operador_asignado_id, null);
      assert.ok(logs[0].hash_actual);
      assert.ok(logs[0].hash_anterior);
    });

    await t.test("audit: cambio y quita de prioridad generan asientos", async () => {
      const { pedidoId, extId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      await actualizarPrioridad(pedidoId, adminId, 5);
      await actualizarPrioridad(pedidoId, adminId, null);
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "PRIORIDAD_PREPARACION_CAMBIADA", registro_id: extId },
        orderBy: { created_at: "asc" },
      });
      assert.equal(logs.length, 2);
      assert.equal((logs[0].valor_anterior as Record<string, unknown>).prioridad_manual, null);
      assert.equal((logs[0].valor_nuevo as Record<string, unknown>).prioridad_manual, 5);
      assert.equal((logs[1].valor_anterior as Record<string, unknown>).prioridad_manual, 5);
      assert.equal((logs[1].valor_nuevo as Record<string, unknown>).prioridad_manual, null);
    });

    await t.test("audit: prioridad igual no genera asiento adicional", async () => {
      const { pedidoId, extId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION", prioridad: 2 });
      await actualizarPrioridad(pedidoId, adminId, 2);
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "PRIORIDAD_PREPARACION_CAMBIADA", registro_id: extId },
      });
      assert.equal(logs.length, 0);
    });

    await t.test("audit: scan nuevo genera asiento con variante y cantidades", async () => {
      const { pedidoId, items } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
      });
      await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "UNIDAD_PREPARACION_CONFIRMADA", registro_id: items[0].id },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].usuario_id, operador1Id);
      assert.equal(logs[0].tabla_afectada, "pedido_venta_items");
      const valorNuevo = logs[0].valor_nuevo as Record<string, unknown>;
      assert.equal(valorNuevo.variante_sku_id, varianteSkuId);
      assert.equal(valorNuevo.cantidad_confirmada, 1);
      assert.equal((logs[0].valor_anterior as Record<string, unknown>).cantidad_confirmada, 0);
    });

    await t.test("audit: retry scan idempotente no duplica asiento", async () => {
      const { pedidoId, items } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
      });
      const scanId = crypto.randomUUID();
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "UNIDAD_PREPARACION_CONFIRMADA", registro_id: items[0].id },
      });
      assert.equal(logs.length, 1);
    });

    await t.test("audit: LISTO genera asiento con plazo y qr_generado sin token", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId, extId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      await completarPreparacion(pedidoId, operador1Id);
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "PEDIDO_LISTO_PARA_RETIRO", registro_id: extId },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].usuario_id, operador1Id);
      assert.equal(logs[0].tabla_afectada, "pedidos_venta_ecommerce");
      const valorAnterior = logs[0].valor_anterior as Record<string, unknown>;
      const valorNuevo = logs[0].valor_nuevo as Record<string, unknown>;
      assert.equal(valorAnterior.estado_ecommerce, "EN_PREPARACION");
      assert.equal(valorNuevo.estado_ecommerce, "LISTO_PARA_RETIRO");
      assert.equal(valorNuevo.qr_generado, true);
      assert.ok(valorNuevo.plazo_retiro_vencimiento);
      const serializado = JSON.stringify(logs[0]);
      assert.ok(!serializado.includes("codigo_qr_retiro"));
      assert.ok(!serializado.includes(varianteSkuSku));
    });

    await t.test("audit: doble completar no duplica asiento LISTO", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId, extId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      await completarPreparacion(pedidoId, operador1Id);
      await completarPreparacion(pedidoId, operador1Id);
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "PEDIDO_LISTO_PARA_RETIRO", registro_id: extId },
      });
      assert.equal(logs.length, 1);
    });

    await t.test("audit: admisión invocada manualmente genera asiento", async () => {
      const { pedidoId, extId } = await crearPedido({ estado_ecommerce: "PAGO_CONFIRMADO" });
      const r = await admitirPedidoPagoConfirmado(prisma, pedidoId);
      domainEventBus.emit(r.evento_pendiente!.tipo, r.evento_pendiente!.payload);
      await esperarAuditLog();

      const logs = await prisma.auditLog.findMany({
        where: { accion: "PEDIDO_ADMITIDO_COLA", registro_id: extId },
      });
      assert.equal(logs.length, 1);
      assert.equal((logs[0].valor_nuevo as Record<string, unknown>).estado_ecommerce, "PAGO_CONFIRMADO");
    });

    await t.test("audit: cadena de hash mantiene integridad", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      await tomarPedido(pedidoId, operador1Id);
      await esperarAuditLog();
      await completarPreparacion(pedidoId, operador1Id);
      await esperarAuditLog();

      const resultado = await verificarCadenaIntegridad();
      assert.equal(resultado.integra, true);
    });
  },
);
