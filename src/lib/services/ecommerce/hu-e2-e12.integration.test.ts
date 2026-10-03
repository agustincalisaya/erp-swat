import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/**
 * HU-E2 → HU-E12 — Integración real del pago web con la admisión a Pick&Pack.
 *
 * Base de test descartable:
 *   docker exec swat_erp_postgres_t01 psql -U erpswat -d postgres \
 *     -c "DROP DATABASE IF EXISTS swat_erp_test_e2e12" \
 *     -c "CREATE DATABASE swat_erp_test_e2e12"
 *   export DATABASE_URL="postgresql://erpswat:erpswat@localhost:5433/swat_erp_test_e2e12?schema=public"
 *   npx prisma migrate deploy && npx prisma db seed
 *   HU_E2_E12_INTEGRATION_DATABASE_URL=$DATABASE_URL node --conditions=react-server --import tsx --test \
 *     src/lib/services/ecommerce/hu-e2-e12.integration.test.ts
 */

const DATABASE_URL = process.env.HU_E2_E12_INTEGRATION_DATABASE_URL;

test(
  "HU-E2 → HU-E12 — pago aprobado integra admisión a Pick&Pack",
  { skip: !DATABASE_URL, timeout: 180_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MP_MODO = "simulado";
    process.env.APP_PUBLIC_URL = "http://localhost:3000";

    const [
      { prisma },
      carrito,
      checkout,
      pagoWeb,
      pickPack,
      { domainEventBus },
      { ServiceError },
      { iniciarAuditLogListener },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./carrito.service.ts"),
      import("./checkout.service.ts"),
      import("./pago-web.service.ts"),
      import("./pick-pack.service.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);

    t.after(async () => {
      let anterior = -1;
      for (let intento = 0; intento < 60; intento++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) break;
        anterior = actual;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await prisma.$disconnect();
    });
    iniciarAuditLogListener();

    const pagosMp = new Map<string, PagoConsultado>();
    const preferenciasCerradas: string[] = [];
    const pasarela = {
      consultarPago: async (id: string) => {
        const pago = pagosMp.get(id);
        if (!pago) throw new ServiceError("PAGO_NO_ENCONTRADO");
        return pago;
      },
      cerrarCobro: async (preferenceId: string) => {
        preferenciasCerradas.push(preferenceId);
      },
    };

    function pagoMp(
      ref: string | null,
      estado: "approved" | "rejected",
      monto: number,
      opciones: { fechaAprobacion?: string | null } = {},
    ): string {
      const id = String(Math.floor(Math.random() * 1e12));
      pagosMp.set(id, {
        payment_id: id,
        estado: estado === "approved" ? "APROBADO" : "RECHAZADO",
        status_mp: estado,
        status_detail: estado === "approved" ? "accredited" : "cc_rejected_insufficient_amount",
        monto,
        moneda: "ARS",
        external_reference: ref,
        fecha_aprobacion:
          opciones.fechaAprobacion !== undefined
            ? opciones.fechaAprobacion
            : estado === "approved"
              ? new Date("2026-10-15T14:30:00.000Z").toISOString()
              : null,
      });
      return id;
    }

    async function compra(opciones: { precio?: number; cantidad?: number } = {}) {
      const articulo = await fixtures.crearArticulo(prisma, {
        stockShowroom: 5,
        precio: opciones.precio ?? 10000,
      });
      const cuenta = await fixtures.crearCuenta(prisma);
      await carrito.agregarAlCarrito(
        { cuentaId: cuenta.cuentaId },
        { variante_sku_id: articulo.varianteId, cantidad: opciones.cantidad ?? 1 },
      );
      const iniciado = await checkout.iniciarCheckout(cuenta.sesion);
      return { articulo, cuenta, iniciado };
    }

    async function crearOperador() {
      const u = await prisma.usuario.create({
        data: {
          nombre_usuario: `op.e2e12.${randomUUID().slice(0, 8)}`,
          email: `op.e2e12.${randomUUID().slice(0, 8)}@test.local`,
          password_hash: "x",
          password_salt: "x",
          nombre_completo: "Operador E2E12",
          estado: "ACTIVO",
        },
      });
      return u.id;
    }

    const estadoPedido = (pedidoVentaId: string) =>
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: pedidoVentaId },
        select: {
          id: true,
          estado_ecommerce: true,
          mercadopago_payment_id: true,
          fecha_pago_confirmado: true,
          operador_asignado_id: true,
          pedido_venta: {
            select: {
              estado: true,
              total: true,
              comprobantes: true,
              medios_pago: true,
              items: { select: { cantidad_facturada: true, reserva: true } },
            },
          },
        },
      });

    const eventos: { nombre: string; payload: Record<string, unknown> }[] = [];
    for (const nombre of ["ecommerce:pedido_pago_confirmado", "ecommerce:pedido_admitido_cola"] as const) {
      domainEventBus.on(nombre, (payload) => eventos.push({ nombre, payload: payload as unknown as Record<string, unknown> }));
    }
    const eventosDe = (nombre: string, pedidoVentaId: string) =>
      eventos.filter((e) => e.nombre === nombre && e.payload.pedido_venta_id === pedidoVentaId);

    await t.test("pago aprobado → PAGO_CONFIRMADO + EN_PREPARACION + ambos eventos", async () => {
      const { iniciado } = await compra({ precio: 8000, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 8000);

      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "CONFIRMADO");

      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "EN_PREPARACION");
      assert.equal(p.mercadopago_payment_id, pid);
      assert.equal(p.operador_asignado_id, null);
      assert.ok(p.fecha_pago_confirmado);
      assert.equal(p.fecha_pago_confirmado.toISOString(), new Date("2026-10-15T14:30:00.000Z").toISOString());
      assert.equal(p.pedido_venta.estado, "FACTURADO");
      assert.equal(p.pedido_venta.comprobantes.length, 1);
      assert.equal(p.pedido_venta.medios_pago.length, 1);
      assert.ok(p.pedido_venta.items.every((i) => i.cantidad_facturada === 1 && i.reserva?.fecha_fin_reserva));

      assert.equal(eventosDe("ecommerce:pedido_pago_confirmado", iniciado.pedido_venta_id).length, 1);
      const admisiones = eventosDe("ecommerce:pedido_admitido_cola", iniciado.pedido_venta_id);
      assert.equal(admisiones.length, 1);
      assert.equal(admisiones[0].payload.estado_nuevo, "EN_PREPARACION");
      assert.equal(admisiones[0].payload.actor_id, null);
    });

    await t.test("fecha de aprobación: fallback cuando MP no envía date_approved", async () => {
      const { iniciado } = await compra({ precio: 6000, cantidad: 1 });
      const antes = Date.now();
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 6000, { fechaAprobacion: null });
      await pagoWeb.procesarNotificacionPago(pid, pasarela);
      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.ok(p.fecha_pago_confirmado);
      assert.ok(p.fecha_pago_confirmado.getTime() >= antes - 1000);
    });

    await t.test("retry idempotente: no doble admisión ni eventos", async () => {
      const { iniciado } = await compra({ precio: 7000, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 7000);

      const r1 = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      const r2 = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r1.resultado, "CONFIRMADO");
      assert.equal(r2.resultado, "SIN_EFECTO");

      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "EN_PREPARACION");
      assert.equal(p.pedido_venta.comprobantes.length, 1);
      assert.equal(p.pedido_venta.medios_pago.length, 1);
      assert.equal(eventosDe("ecommerce:pedido_pago_confirmado", iniciado.pedido_venta_id).length, 1);
      assert.equal(eventosDe("ecommerce:pedido_admitido_cola", iniciado.pedido_venta_id).length, 1);
    });

    await t.test("dos callbacks concurrentes del mismo pago: una sola admisión", async () => {
      const { iniciado } = await compra({ precio: 5500, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 5500);

      const [r1, r2] = await Promise.all([
        pagoWeb.procesarNotificacionPago(pid, pasarela),
        pagoWeb.procesarNotificacionPago(pid, pasarela),
      ]);
      assert.deepEqual([r1.resultado, r2.resultado].sort(), ["CONFIRMADO", "SIN_EFECTO"]);

      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "EN_PREPARACION");
      assert.equal(p.pedido_venta.comprobantes.length, 1);
      assert.equal(eventosDe("ecommerce:pedido_pago_confirmado", iniciado.pedido_venta_id).length, 1);
      assert.equal(eventosDe("ecommerce:pedido_admitido_cola", iniciado.pedido_venta_id).length, 1);
    });

    await t.test("compatibilidad de locks: E2 y E12 no deadlock", async () => {
      const { iniciado } = await compra({ precio: 9000, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 9000);
      const operadorId = await crearOperador();

      // E2 inicia primero y toma el lock del agregado; tomarPedido reintenta
      // hasta que el estado sea EN_PREPARACION. Eso demuestra que ambos usan
      // una jerarquía de locks compatible y que no hay deadlock.
      const [rPago, rToma] = await Promise.all([
        pagoWeb.procesarNotificacionPago(pid, pasarela),
        (async () => {
          for (let i = 0; i < 40; i++) {
            try {
              return await pickPack.tomarPedido(iniciado.pedido_venta_id, operadorId);
            } catch (error) {
              if (
                error instanceof ServiceError &&
                (error.code === "ESTADO_INVALIDO" || error.code === "CONCURRENCIA_ASIGNACION")
              ) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                continue;
              }
              throw error;
            }
          }
          throw new Error("timeout esperando que E2 libere el pedido");
        })(),
      ]);

      assert.equal(rPago.resultado, "CONFIRMADO");
      assert.equal(rToma.cambio_realizado, true);
      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "EN_PREPARACION");
      assert.equal(p.operador_asignado_id, operadorId);
    });

    await t.test("rollback local: no admisión ni evento ante monto discrepante", async () => {
      const { iniciado } = await compra({ precio: 5000, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 4999.99);
      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "ANOMALIA");
      assert.equal(r.motivo, "MONTO_DISCREPANTE");

      const p = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: iniciado.pedido_venta_id },
      });
      assert.equal(p.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(p.fecha_pago_confirmado, null);
      assert.equal(eventosDe("ecommerce:pedido_admitido_cola", iniciado.pedido_venta_id).length, 0);
    });

    await t.test("listener de pago que lanza no evita la admisión", async () => {
      const { iniciado } = await compra({ precio: 4000, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 4000);
      const throwing = () => {
        throw new Error("pago-intencional");
      };
      domainEventBus.on("ecommerce:pedido_pago_confirmado" as never, throwing as never);
      try {
        const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
        assert.equal(r.resultado, "CONFIRMADO");

        const p = await estadoPedido(iniciado.pedido_venta_id);
        assert.equal(p.estado_ecommerce, "EN_PREPARACION");
        assert.ok(p.fecha_pago_confirmado);
        assert.equal(eventosDe("ecommerce:pedido_admitido_cola", iniciado.pedido_venta_id).length, 1);
      } finally {
        domainEventBus.off("ecommerce:pedido_pago_confirmado" as never, throwing as never);
      }
    });

    await t.test("listener de admisión que lanza no revierte el pago", async () => {
      const { iniciado } = await compra({ precio: 3000, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 3000);
      const throwing = () => {
        throw new Error("admision-intencional");
      };
      domainEventBus.on("ecommerce:pedido_admitido_cola" as never, throwing as never);
      try {
        const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
        assert.equal(r.resultado, "CONFIRMADO");

        const p = await estadoPedido(iniciado.pedido_venta_id);
        assert.equal(p.estado_ecommerce, "EN_PREPARACION");
        assert.ok(p.fecha_pago_confirmado);
      } finally {
        domainEventBus.off("ecommerce:pedido_admitido_cola" as never, throwing as never);
      }
    });

    await t.test("auditoría: PAGO_CONFIRMADO y PEDIDO_ADMITIDO_COLA coexisten", async () => {
      const { iniciado } = await compra({ precio: 6500, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 6500);
      await pagoWeb.procesarNotificacionPago(pid, pasarela);

      await new Promise((resolve) => setTimeout(resolve, 500));
      const pve = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: iniciado.pedido_venta_id },
      });
      const logs = await prisma.auditLog.findMany({
        where: { registro_id: pve.id },
        orderBy: { created_at: "asc" },
      });
      const acciones = logs.map((l) => l.accion);
      assert.ok(acciones.includes("PAGO_CONFIRMADO"));
      assert.ok(acciones.includes("PEDIDO_ADMITIDO_COLA"));

      const { verificarCadenaIntegridad } = await import("../auditoria/audit-log.service.ts");
      const integrity = await verificarCadenaIntegridad();
      assert.equal(integrity.integra, true);
    });

    await t.test("pago rechazado no admite en cola", async () => {
      const { iniciado } = await compra({ precio: 4500, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "rejected", 4500);
      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "RECHAZADO");

      const p = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: iniciado.pedido_venta_id },
      });
      assert.equal(p.estado_ecommerce, "PAGO_RECHAZADO");
      assert.equal(eventosDe("ecommerce:pedido_admitido_cola", iniciado.pedido_venta_id).length, 0);
    });

    await t.test("pago anómalo no admite en cola", async () => {
      const { iniciado } = await compra({ precio: 3500, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 3500.01);
      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "ANOMALIA");
      assert.equal(r.motivo, "MONTO_DISCREPANTE");

      const p = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: iniciado.pedido_venta_id },
      });
      assert.equal(p.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(eventosDe("ecommerce:pedido_admitido_cola", iniciado.pedido_venta_id).length, 0);
    });
  },
);
