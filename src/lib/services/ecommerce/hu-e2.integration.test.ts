import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/**
 * HU-E2 — Nivel 2: integración de checkout + pago contra una base REAL
 * descartable, con la pasarela de Mercado Pago FALSA (inyectada en
 * `procesarNotificacionPago`) y `MP_MODO=simulado` para la preferencia: sin red.
 *
 *   docker exec swat_erp_postgres psql -U erpswat -d postgres \
 *     -c "DROP DATABASE IF EXISTS swat_erp_test_e2" -c "CREATE DATABASE swat_erp_test_e2"
 *   export TEST_DB="postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e2?schema=public"
 *   DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
 *   HU_E2_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e2
 *
 * Cada escenario crea SUS artículos, cuenta y cupón (fixtures de HU-E1). Nunca
 * se borra nada (Regla N.° 1): la base es descartable.
 */

const DATABASE_URL = process.env.HU_E2_INTEGRATION_DATABASE_URL;
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";

test(
  "HU-E2 — checkout con Mercado Pago, confirmación y rechazo por webhook",
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
      { domainEventBus },
      { ServiceError },
      { iniciarAuditLogListener },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./carrito.service.ts"),
      import("./checkout.service.ts"),
      import("./pago-web.service.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);
    // Los asientos de auditoría son fire-and-forget (listener): se espera a que
    // la cola se vacíe (conteo estable) antes de desconectar Prisma.
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

    // ── Pasarela falsa: lo que "responde Mercado Pago" ───────────────────────
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
    function pagoMp(ref: string | null, estado: "approved" | "rejected", monto: number): string {
      const id = String(Math.floor(Math.random() * 1e12));
      pagosMp.set(id, {
        payment_id: id,
        estado: estado === "approved" ? "APROBADO" : "RECHAZADO",
        status_mp: estado,
        status_detail: estado === "approved" ? "accredited" : "cc_rejected_insufficient_amount",
        monto,
        moneda: "ARS",
        external_reference: ref,
        fecha_aprobacion: estado === "approved" ? new Date().toISOString() : null,
      });
      return id;
    }

    // ── Eventos emitidos ─────────────────────────────────────────────────────
    const eventos: { nombre: string; payload: Record<string, unknown> }[] = [];
    for (const nombre of ["ecommerce:pedido_pago_confirmado", "ecommerce:pago_rechazado", "ecommerce:pago_anomalo"] as const) {
      domainEventBus.on(nombre, (payload) => eventos.push({ nombre, payload: payload as unknown as Record<string, unknown> }));
    }
    const eventosDe = (nombre: string, pedidoVentaId: string) =>
      eventos.filter((e) => e.nombre === nombre && e.payload.pedido_venta_id === pedidoVentaId);

    // ── Fixtures ─────────────────────────────────────────────────────────────
    async function compra(opciones: { stock?: number; precio?: number; cantidad?: number; cupon?: string } = {}) {
      const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: opciones.stock ?? 5, precio: opciones.precio ?? 10000 });
      const cuenta = await fixtures.crearCuenta(prisma);
      await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: opciones.cantidad ?? 2 });
      const iniciado = await checkout.iniciarCheckout(cuenta.sesion, opciones.cupon ? { cupon_codigo: opciones.cupon } : {});
      return { articulo, cuenta, iniciado };
    }
    async function crearCupon(valor: number, limiteGlobal: number | null = null) {
      const codigo = `E2${randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.cuponDescuento.create({
        data: {
          codigo,
          tipo_beneficio: "PORCENTAJE",
          valor,
          vigente_desde: new Date(Date.now() - 86_400_000),
          vigente_hasta: new Date(Date.now() + 86_400_000),
          limite_uso_global: limiteGlobal,
          limite_uso_por_cliente: 5,
        },
      });
      return codigo;
    }
    const stockShowroom = async (varianteId: string) =>
      (
        await prisma.stockDeposito.findUniqueOrThrow({
          where: { variante_sku_id_deposito_id: { variante_sku_id: varianteId, deposito_id: DEPOSITO_SHOWROOM_ID } },
        })
      ).cantidad;
    const estadoPedido = (pedidoVentaId: string) =>
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: pedidoVentaId },
        select: {
          estado_ecommerce: true,
          is_active: true,
          mercadopago_payment_id: true,
          pedido_venta: {
            select: {
              estado: true,
              is_active: true,
              deletion_reason: true,
              fecha_facturacion: true,
              total: true,
              comprobantes: true,
              medios_pago: true,
              items: { select: { cantidad_facturada: true, reserva: true } },
            },
          },
        },
      });

    // ── CA5 / P2 — checkout con cupón: total neto calculado en el servidor ──
    await t.test("CA5 — checkout con cupón: total neto, CuponAplicacion sin confirmar y checkout_url", async () => {
      const cupon = await crearCupon(10);
      const { iniciado, cuenta } = await compra({ precio: 10000, cantidad: 2, cupon });
      assert.equal(iniciado.total, 18000); // 2 × 10000 − 10 %
      assert.ok(iniciado.checkout_url, "la respuesta trae la URL de Checkout Pro");
      const pedido = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { id: iniciado.pedido_venta_ecommerce_id },
        include: { cupon_aplicacion: true, pedido_venta: true },
      });
      assert.equal(pedido.pedido_venta.total.toNumber(), 18000);
      assert.equal(pedido.cupon_aplicacion?.confirmada, false);
      assert.ok(pedido.mercadopago_preference_id);
      assert.equal(pedido.pedido_venta.registrado_por_id !== null, true);
      assert.equal(pedido.pedido_venta.turno_caja_id, null, "CA4: sin turno de caja");
      assert.equal(pedido.pedido_venta.canal, "WEB");

      // Reintento (doble clic): mismo pedido y MISMA preferencia.
      const otraVez = await checkout.iniciarCheckout(cuenta.sesion);
      assert.equal(otraVez.pedido_venta_id, iniciado.pedido_venta_id);
      assert.equal(otraVez.checkout_url, iniciado.checkout_url);
    });

    await t.test("P2 — cupón inexistente → 422 CUPON_NO_ENCONTRADO y nada queda reservado", async () => {
      const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 3 });
      const cuenta = await fixtures.crearCuenta(prisma);
      await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 1 });
      await assert.rejects(
        checkout.iniciarCheckout(cuenta.sesion, { cupon_codigo: "NOEXISTE99" }),
        (e: unknown) => e instanceof ServiceError && e.code === "CUPON_NO_ENCONTRADO",
      );
      assert.equal(await stockShowroom(articulo.varianteId), 3);
    });

    // ── CA6 — aprobado ───────────────────────────────────────────────────────
    await t.test("CA6 — pago aprobado: VENDIDO + FACTURADO + Factura B + PAGO_CONFIRMADO + cupón consumido + evento", async () => {
      const cupon = await crearCupon(10);
      const { articulo, iniciado } = await compra({ stock: 5, cantidad: 2, cupon });
      assert.equal(await stockShowroom(articulo.varianteId), 3);

      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 18000);
      const r = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(r.resultado, "CONFIRMADO");

      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "PAGO_CONFIRMADO", "no pasa a EN_PREPARACION (es de HU-E12)");
      assert.equal(p.mercadopago_payment_id, pid);
      assert.equal(p.pedido_venta.estado, "FACTURADO");
      assert.ok(p.pedido_venta.fecha_facturacion);
      assert.equal(p.pedido_venta.comprobantes.length, 1);
      assert.equal(p.pedido_venta.comprobantes[0].tipo_comprobante, "FACTURA_B");
      assert.equal(p.pedido_venta.comprobantes[0].monto_total.toNumber(), 18000);
      assert.equal(p.pedido_venta.medios_pago[0].medio, "MERCADO_PAGO");
      assert.equal(p.pedido_venta.medios_pago[0].referencia, pid);
      assert.ok(p.pedido_venta.items.every((i) => i.cantidad_facturada === 2 && i.reserva?.fecha_fin_reserva));
      assert.equal(await stockShowroom(articulo.varianteId), 3, "VENDIDO no reincrementa el disponible");

      const aplicacion = await prisma.cuponAplicacion.findFirstOrThrow({ where: { pedido_venta_id: iniciado.pedido_venta_id } });
      assert.equal(aplicacion.confirmada, true);

      const confirmado = eventosDe("ecommerce:pedido_pago_confirmado", iniciado.pedido_venta_id);
      assert.equal(confirmado.length, 1);
      assert.equal(confirmado[0].payload.mercadopago_payment_id, pid);
      assert.equal(confirmado[0].payload.monto, 18000);
      assert.equal(confirmado[0].payload.moneda, "ARS");

      // CA3 — la misma notificación otra vez: sin efectos.
      const repetido = await pagoWeb.procesarNotificacionPago(pid, pasarela);
      assert.equal(repetido.resultado, "SIN_EFECTO");
      const despues = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(despues.pedido_venta.comprobantes.length, 1);
      assert.equal(despues.pedido_venta.medios_pago.length, 1);
      assert.equal(eventosDe("ecommerce:pedido_pago_confirmado", iniciado.pedido_venta_id).length, 1);
    });

    await t.test("CA3 — dos notificaciones concurrentes del mismo pago: una sola confirmación", async () => {
      const { iniciado } = await compra({ precio: 5000, cantidad: 1 });
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 5000);
      const resultados = await Promise.all([
        pagoWeb.procesarNotificacionPago(pid, pasarela),
        pagoWeb.procesarNotificacionPago(pid, pasarela),
      ]);
      assert.deepEqual(resultados.map((r) => r.resultado).sort(), ["CONFIRMADO", "SIN_EFECTO"]);
      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.pedido_venta.comprobantes.length, 1);
    });

    await t.test("D-E2-5 — segundo pago aprobado (otro payment_id) → PAGO_DUPLICADO, sin efectos", async () => {
      const { iniciado } = await compra({ precio: 5000, cantidad: 1 });
      await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 5000), pasarela);
      const r = await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 5000), pasarela);
      assert.equal(r.resultado, "ANOMALIA");
      assert.equal(r.motivo, "PAGO_DUPLICADO");
      assert.equal((await estadoPedido(iniciado.pedido_venta_id)).pedido_venta.comprobantes.length, 1);
    });

    // ── P13 ──────────────────────────────────────────────────────────────────
    await t.test("P13 — monto distinto: no confirma, no libera la reserva, evento de discrepancia", async () => {
      const { articulo, iniciado } = await compra({ precio: 5000, cantidad: 1, stock: 4 });
      const r = await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 4999.99), pasarela);
      assert.equal(r.resultado, "ANOMALIA");
      assert.equal(r.motivo, "MONTO_DISCREPANTE");
      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(p.mercadopago_payment_id, null);
      assert.equal(p.pedido_venta.estado, "RESERVADO");
      assert.ok(p.pedido_venta.items.every((i) => i.reserva?.fecha_fin_reserva === null));
      assert.equal(await stockShowroom(articulo.varianteId), 3);
      const anomalo = eventos.find((e) => e.nombre === "ecommerce:pago_anomalo" && e.payload.pedido_venta_id === iniciado.pedido_venta_id);
      assert.equal(anomalo?.payload.monto_esperado, 5000);
    });

    // ── CA7 — rechazado ──────────────────────────────────────────────────────
    await t.test("CA7 — rechazado: libera ya, PAGO_RECHAZADO sin borrar, PedidoVenta ANULADO, carrito reconstruido, cupón de baja", async () => {
      const cupon = await crearCupon(10);
      const { articulo, cuenta, iniciado } = await compra({ stock: 5, cantidad: 2, cupon });
      assert.equal(await stockShowroom(articulo.varianteId), 3);
      const preference = (await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { id: iniciado.pedido_venta_ecommerce_id } }))
        .mercadopago_preference_id;

      const r = await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "rejected", 18000), pasarela);
      assert.equal(r.resultado, "RECHAZADO");

      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "PAGO_RECHAZADO");
      assert.equal(p.is_active, true, "el pedido web no se elimina");
      assert.equal(p.pedido_venta.estado, "ANULADO");
      assert.equal(p.pedido_venta.is_active, false);
      assert.match(p.pedido_venta.deletion_reason ?? "", /Pago rechazado/);
      assert.ok(p.pedido_venta.items.every((i) => i.reserva?.fecha_fin_reserva));
      assert.equal(await stockShowroom(articulo.varianteId), 5, "la reserva se liberó de inmediato");

      const aplicacion = await prisma.cuponAplicacion.findFirstOrThrow({ where: { pedido_venta_id: iniciado.pedido_venta_id } });
      assert.equal(aplicacion.is_active, false);
      assert.deepEqual(preferenciasCerradas.slice(-1), [preference], "Q2: la preferencia se cerró");
      assert.equal(eventosDe("ecommerce:pago_rechazado", iniciado.pedido_venta_id).length, 1);

      const vista = await carrito.obtenerCarrito({ cuentaId: cuenta.cuentaId });
      assert.deepEqual(vista.items.map((i) => [i.variante_sku_id, i.cantidad]), [[articulo.varianteId, 2]]);

      // Reintento: checkout NUEVO (otro pedido), re-reserva.
      const nuevo = await checkout.iniciarCheckout(cuenta.sesion);
      assert.notEqual(nuevo.pedido_venta_id, iniciado.pedido_venta_id);
      assert.equal(nuevo.reutilizado, false);
      assert.equal(await stockShowroom(articulo.varianteId), 3);

      // Q2 — un aprobado tardío sobre el pedido rechazado no se confirma.
      const tardio = await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 18000), pasarela);
      assert.equal(tardio.motivo, "PAGO_TARDIO");
      assert.equal((await estadoPedido(iniciado.pedido_venta_id)).estado_ecommerce, "PAGO_RECHAZADO");
    });

    await t.test("Q2 — aprobado con la reserva vencida (aunque no liberada) → PAGO_TARDIO, nada se confirma", async () => {
      const { iniciado } = await compra({ precio: 5000, cantidad: 1 });
      const items = await prisma.pedidoVentaItem.findMany({ where: { pedido_venta_id: iniciado.pedido_venta_id } });
      await prisma.reserva.updateMany({
        where: { id: { in: items.map((i) => i.reserva_id!) } },
        data: { fecha_expiracion: new Date(Date.now() - 60_000) },
      });
      const r = await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", 5000), pasarela);
      assert.equal(r.motivo, "PAGO_TARDIO");
      const p = await estadoPedido(iniciado.pedido_venta_id);
      assert.equal(p.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(p.pedido_venta.comprobantes.length, 0);
    });

    // HU-E4 (spec E §2.4.b): la reserva del primer checkout ocupa el único
    // lugar del cupón, así que el segundo se rechaza antes de pagar y ya no
    // hay sobreconsumo que informar al confirmar.
    await t.test("Q3 — cupón de límite 1 reservado por un checkout: el segundo se rechaza con CUPON_LIMITE_ALCANZADO", async () => {
      const cupon = await crearCupon(10, 1);
      const a = await compra({ precio: 10000, cantidad: 1, cupon });
      await assert.rejects(
        compra({ precio: 10000, cantidad: 1, cupon }),
        (e: unknown) => e instanceof ServiceError && e.code === "CUPON_LIMITE_ALCANZADO",
      );
      const r = await pagoWeb.procesarNotificacionPago(pagoMp(a.iniciado.pedido_venta_ecommerce_id, "approved", 9000), pasarela);
      assert.equal(r.resultado, "CONFIRMADO");
      const anomalo = eventos.find(
        (e) => e.nombre === "ecommerce:pago_anomalo" && e.payload.pedido_venta_id === a.iniciado.pedido_venta_id,
      );
      assert.equal(anomalo, undefined, "sin CUPON_LIMITE_EXCEDIDO: la reserva ya ocupaba el lugar");
    });

    await t.test("D-E2-6 — pago huérfano (sin external_reference o pedido inexistente) → ANOMALIA", async () => {
      assert.equal((await pagoWeb.procesarNotificacionPago(pagoMp(null, "approved", 100), pasarela)).motivo, "PAGO_HUERFANO");
      assert.equal((await pagoWeb.procesarNotificacionPago(pagoMp(randomUUID(), "approved", 100), pasarela)).motivo, "PAGO_HUERFANO");
      assert.equal((await pagoWeb.procesarNotificacionPago("no-existe-en-mp", pasarela)).resultado, "SIN_EFECTO");
    });
  },
);
