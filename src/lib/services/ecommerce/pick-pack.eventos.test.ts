import assert from "node:assert/strict";
import test from "node:test";
import { EstadoEcommerce } from "@prisma/client";
import type {
  EcommercePedidoListoParaRetiroPayload,
  EcommercePedidoTomadoPayload,
  EcommercePrioridadPreparacionCambiadaPayload,
  EcommerceUnidadPreparacionConfirmadaPayload,
} from "@/lib/events/event-types";

const DATABASE_URL = process.env.HU_E12_PICK_PACK_INTEGRATION_DATABASE_URL;

test(
  "HU-E12 — eventos de dominio post-COMMIT",
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
      { ServiceError },
      { domainEventBus },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./pick-pack.service.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/domain-event-bus.ts"),
    ]);

    t.after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await prisma.$disconnect();
    });

    let adminId: string;
    let operador1Id: string;
    let operador2Id: string;
    let clienteId: string;
    let varianteSkuId: string;
    let varianteSkuSku: string;

    async function fixtureBase() {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const proveedor = await prisma.proveedor.create({
        data: { razon_social: "Proveedor Eventos E12", cuit: `30-${suffix}`, estado: "HOMOLOGADO" },
        select: { id: true },
      });

      const producto = await prisma.productoMaestro.create({
        data: {
          codigo_producto: `PPE12EVT-${suffix}`,
          nombre: "Producto E12 Eventos",
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
          sku: `PPE12EVT-L-AZUL-H-${suffix}`,
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
            nombre_usuario: `admin.e12evt.${suffix}`,
            email: `admin.e12evt.${suffix}@test.local`,
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
            nombre_usuario: `op1.e12evt.${suffix}`,
            email: `op1.e12evt.${suffix}@test.local`,
            password_hash: "x",
            password_salt: "x",
            nombre_completo: "Operador 1",
            estado: "ACTIVO",
          },
          select: { id: true },
        })
      ).id;

      operador2Id = (
        await prisma.usuario.create({
          data: {
            nombre_usuario: `op2.e12evt.${suffix}`,
            email: `op2.e12evt.${suffix}@test.local`,
            password_hash: "x",
            password_salt: "x",
            nombre_completo: "Operador 2",
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
        canal?: "WEB" | "MOSTRADOR";
      } = {},
    ) {
      const numero = `V-E12EVT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

    function capturar<T>(eventName: string): { eventos: T[]; off: () => void } {
      const eventos: T[] = [];
      const handler = (payload: T) => eventos.push(payload);
      domainEventBus.on(eventName as never, handler as never);
      return {
        eventos,
        off: () => domainEventBus.off(eventName as never, handler as never),
      };
    }

    async function configurarPlazoRetiro(valor: string) {
      await prisma.configuracionSistema.upsert({
        where: { clave: "ECOMMERCE_PLAZO_RETIRO_DIAS" },
        update: { valor, actualizado_por_id: adminId },
        create: { clave: "ECOMMERCE_PLAZO_RETIRO_DIAS", valor, modulo: "E", actualizado_por_id: adminId },
      });
    }

    await fixtureBase();

    await t.test("eventos: toma nueva emite exactamente un evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      const { eventos, off } = capturar<EcommercePedidoTomadoPayload>("ecommerce:pedido_tomado");
      try {
        await tomarPedido(pedidoId, operador1Id);
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0].pedido_venta_id, pedidoId);
        assert.equal(eventos[0].actor_id, operador1Id);
        assert.equal(eventos[0].estado, "EN_PREPARACION");
        assert.ok(eventos[0].evento_id);
        assert.ok(eventos[0].timestamp);
      } finally {
        off();
      }
    });

    await t.test("eventos: retry de toma no emite evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      await tomarPedido(pedidoId, operador1Id);
      const { eventos, off } = capturar<EcommercePedidoTomadoPayload>("ecommerce:pedido_tomado");
      try {
        await tomarPedido(pedidoId, operador1Id);
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: conflicto de toma no emite evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      await tomarPedido(pedidoId, operador1Id);
      const { eventos, off } = capturar<EcommercePedidoTomadoPayload>("ecommerce:pedido_tomado");
      try {
        await assert.rejects(() => tomarPedido(pedidoId, operador2Id), ServiceError);
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: cambio de prioridad emite un evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      const { eventos, off } = capturar<EcommercePrioridadPreparacionCambiadaPayload>("ecommerce:prioridad_preparacion_cambiada");
      try {
        await actualizarPrioridad(pedidoId, adminId, 5);
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0].pedido_venta_id, pedidoId);
        assert.equal(eventos[0].prioridad_anterior, null);
        assert.equal(eventos[0].prioridad_nueva, 5);
        assert.equal(eventos[0].actor_id, adminId);
      } finally {
        off();
      }
    });

    await t.test("eventos: quitar prioridad emite un evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION", prioridad: 5 });
      const { eventos, off } = capturar<EcommercePrioridadPreparacionCambiadaPayload>("ecommerce:prioridad_preparacion_cambiada");
      try {
        await actualizarPrioridad(pedidoId, adminId, null);
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0].prioridad_anterior, 5);
        assert.equal(eventos[0].prioridad_nueva, null);
      } finally {
        off();
      }
    });

    await t.test("eventos: prioridad igual no emite evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION", prioridad: 3 });
      const { eventos, off } = capturar<EcommercePrioridadPreparacionCambiadaPayload>("ecommerce:prioridad_preparacion_cambiada");
      try {
        await actualizarPrioridad(pedidoId, adminId, 3);
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: scan nuevo emite un evento por unidad", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION", operador_asignado_id: operador1Id });
      const { eventos, off } = capturar<EcommerceUnidadPreparacionConfirmadaPayload>("ecommerce:unidad_preparacion_confirmada");
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0].pedido_venta_id, pedidoId);
        assert.equal(eventos[0].variante_sku_id, varianteSkuId);
        assert.equal(eventos[0].actor_id, operador1Id);
        assert.equal(eventos[0].cantidad_confirmada_anterior, 0);
        assert.equal(eventos[0].cantidad_confirmada_nueva, 1);
      } finally {
        off();
      }
    });

    await t.test("eventos: retry del mismo scan_id no emite evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION", operador_asignado_id: operador1Id });
      const scanId = crypto.randomUUID();
      await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
      const { eventos, off } = capturar<EcommerceUnidadPreparacionConfirmadaPayload>("ecommerce:unidad_preparacion_confirmada");
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: scanId, codigo: varianteSkuSku });
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: scan rechazado no emite evento", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION", operador_asignado_id: operador1Id });
      const { eventos, off } = capturar<EcommerceUnidadPreparacionConfirmadaPayload>("ecommerce:unidad_preparacion_confirmada");
      try {
        await assert.rejects(
          () => confirmarItem(pedidoId, operador2Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku }),
          ServiceError,
        );
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: dos unidades reales emiten dos eventos", async () => {
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        cantidad: 2,
      });
      const { eventos, off } = capturar<EcommerceUnidadPreparacionConfirmadaPayload>("ecommerce:unidad_preparacion_confirmada");
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
        assert.equal(eventos.length, 2);
        assert.equal(eventos[0].cantidad_confirmada_nueva, 1);
        assert.equal(eventos[1].cantidad_confirmada_nueva, 1);
      } finally {
        off();
      }
    });

    await t.test("eventos: primera finalización emite LISTO", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      const { eventos, off } = capturar<EcommercePedidoListoParaRetiroPayload>("ecommerce:pedido_listo_para_retiro");
      try {
        await completarPreparacion(pedidoId, operador1Id);
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0].pedido_venta_id, pedidoId);
        assert.equal(eventos[0].estado_anterior, "EN_PREPARACION");
        assert.equal(eventos[0].estado_nuevo, "LISTO_PARA_RETIRO");
        assert.equal(eventos[0].actor_id, operador1Id);
        assert.ok(eventos[0].plazo_retiro_vencimiento);
        assert.ok(!Reflect.get(eventos[0] as object, "codigo_qr_retiro"));
      } finally {
        off();
      }
    });

    await t.test("eventos: doble completar no emite segundo evento", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      await completarPreparacion(pedidoId, operador1Id);
      const { eventos, off } = capturar<EcommercePedidoListoParaRetiroPayload>("ecommerce:pedido_listo_para_retiro");
      try {
        await completarPreparacion(pedidoId, operador1Id);
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: completar con config inválida no emite evento", async () => {
      await configurarPlazoRetiro("0");
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      const { eventos, off } = capturar<EcommercePedidoListoParaRetiroPayload>("ecommerce:pedido_listo_para_retiro");
      try {
        await assert.rejects(() => completarPreparacion(pedidoId, operador1Id), ServiceError);
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: completar incompleto no emite evento", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
      });
      const { eventos, off } = capturar<EcommercePedidoListoParaRetiroPayload>("ecommerce:pedido_listo_para_retiro");
      try {
        await assert.rejects(() => completarPreparacion(pedidoId, operador1Id), ServiceError);
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: admisión devuelve evento pendiente pero no lo emite", async () => {
      const { pedidoId, extId } = await crearPedido({ estado_ecommerce: "PAGO_CONFIRMADO" });
      const { eventos, off } = capturar<unknown>("ecommerce:pedido_admitido_cola");
      try {
        const r = await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
        assert.equal(r.transicion_realizada, true);
        assert.equal(r.evento_pendiente?.tipo, "ecommerce:pedido_admitido_cola");
        assert.equal(r.evento_pendiente?.payload.pedido_venta_id, pedidoId);
        assert.equal(r.evento_pendiente?.payload.pedido_venta_ecommerce_id, extId);
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: admisión idempotente no devuelve evento pendiente", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "PAGO_CONFIRMADO" });
      await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      const r = await prisma.$transaction(async (tx) => admitirPedidoPagoConfirmado(tx, pedidoId));
      assert.equal(r.transicion_realizada, false);
      assert.equal(r.evento_pendiente, undefined);
    });

    await t.test("eventos: rollback externo no emite nada desde E12", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "PAGO_CONFIRMADO" });
      const { eventos, off } = capturar<unknown>("ecommerce:pedido_admitido_cola");
      try {
        try {
          await prisma.$transaction(async (tx) => {
            await admitirPedidoPagoConfirmado(tx, pedidoId);
            throw new Error("rollback-simulado");
          });
        } catch {
          // esperado
        }
        assert.equal(eventos.length, 0);
      } finally {
        off();
      }
    });

    await t.test("eventos: post-commit listener observa estado persistido", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      let observado = false;
      const handler = async (payload: EcommercePedidoTomadoPayload) => {
        const ext = await prisma.pedidoVentaEcommerce.findUnique({
          where: { pedido_venta_id: payload.pedido_venta_id },
        });
        if (ext?.operador_asignado_id === operador1Id) {
          observado = true;
        }
      };
      domainEventBus.on("ecommerce:pedido_tomado" as never, handler as never);
      try {
        await tomarPedido(pedidoId, operador1Id);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(observado, true);
      } finally {
        domainEventBus.off("ecommerce:pedido_tomado" as never, handler as never);
      }
    });

    await t.test("eventos: fallo de listener TOMADO no revierte ni rechaza la operación", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION" });
      const throwing = () => {
        throw new Error("listener-intencional");
      };
      domainEventBus.on("ecommerce:pedido_tomado" as never, throwing as never);
      try {
        const r = await tomarPedido(pedidoId, operador1Id);
        assert.equal(r.cambio_realizado, true);
        const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
        assert.equal(ext?.operador_asignado_id, operador1Id);
      } finally {
        domainEventBus.off("ecommerce:pedido_tomado" as never, throwing as never);
      }
    });

    await t.test("eventos: fallo de listener LISTO no revierte ni rechaza la operación", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      const throwing = () => {
        throw new Error("listener-listo-intencional");
      };
      domainEventBus.on("ecommerce:pedido_listo_para_retiro" as never, throwing as never);
      try {
        const r = await completarPreparacion(pedidoId, operador1Id);
        assert.equal(r.cambio_realizado, true);
        assert.equal(r.estado_ecommerce, "LISTO_PARA_RETIRO");
        const ext = await prisma.pedidoVentaEcommerce.findUnique({ where: { pedido_venta_id: pedidoId } });
        assert.equal(ext?.estado_ecommerce, "LISTO_PARA_RETIRO");
        assert.ok(ext?.codigo_qr_retiro);
        assert.ok(ext?.plazo_retiro_vencimiento);
      } finally {
        domainEventBus.off("ecommerce:pedido_listo_para_retiro" as never, throwing as never);
      }
    });

    await t.test("eventos: payload de scan no expone código escaneado ni EAN", async () => {
      const { pedidoId } = await crearPedido({ estado_ecommerce: "EN_PREPARACION", operador_asignado_id: operador1Id });
      const { eventos, off } = capturar<EcommerceUnidadPreparacionConfirmadaPayload>("ecommerce:unidad_preparacion_confirmada");
      try {
        await confirmarItem(pedidoId, operador1Id, { scan_id: crypto.randomUUID(), codigo: varianteSkuSku });
        const payload = JSON.stringify(eventos[0]);
        assert.ok(!payload.includes("codigo_escaneado"));
        assert.ok(!payload.includes("scan_id"));
        assert.ok(!payload.includes(varianteSkuSku));
      } finally {
        off();
      }
    });

    await t.test("eventos: payload LISTO no expone QR ni PII", async () => {
      await configurarPlazoRetiro("10");
      const { pedidoId } = await crearPedido({
        estado_ecommerce: "EN_PREPARACION",
        operador_asignado_id: operador1Id,
        escaneos: 1,
      });
      const { eventos, off } = capturar<EcommercePedidoListoParaRetiroPayload>("ecommerce:pedido_listo_para_retiro");
      try {
        await completarPreparacion(pedidoId, operador1Id);
        const payload = JSON.stringify(eventos[0]);
        assert.ok(!payload.includes("codigo_qr_retiro"));
      } finally {
        off();
      }
    });
  },
);
