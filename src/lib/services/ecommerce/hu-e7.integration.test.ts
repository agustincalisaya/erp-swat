import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/**
 * HU-E7 — Nivel 2: anulación de orden web no abonada (manual y automática por
 * TTL) contra una base REAL descartable (task_relos.md §6.2). Mismo patrón que
 * `hu-e2.integration.test.ts`: pasarela de Mercado Pago FALSA inyectada y
 * `MP_MODO=simulado`, sin red. `skip` sin `HU_E7_INTEGRATION_DATABASE_URL`.
 *
 *   docker exec swat_erp_postgres psql -U erpswat -d postgres \
 *     -c "CREATE DATABASE swat_erp_test_e7 TEMPLATE template0"
 *   DATABASE_URL=$TEST_DB npx prisma migrate deploy && DATABASE_URL=$TEST_DB npx prisma db seed
 *   HU_E7_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e7
 *
 * Las órdenes se crean con el checkout y el pago reales (E1/E2). Únicas
 * escrituras directas, deliberadas y documentadas: mover `fecha_expiracion`
 * al pasado (simular el vencimiento, decisión 6 del Paso 1) y fijar
 * `estado_ecommerce` en PAGO_CONFIRMADO / CANCELADO / VENCIDO_SIN_RETIRO para
 * la matriz del 409 (ningún servicio deja una orden en reposo en esos estados:
 * la confirmación pasa a EN_PREPARACION en el mismo commit y HU-E13 no existe).
 * Nunca se borra nada (Regla N.° 1).
 */

const DATABASE_URL = process.env.HU_E7_INTEGRATION_DATABASE_URL;

// IDs fijos de prisma/seed.ts.
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";
const PEDIDO_WEB_PAGO_RECHAZADO_SEED_ID = "a78b0893-c771-4ed1-b726-e5a3bc257645";
const PEDIDO_WEB_EN_PREPARACION_SEED_ID = "91a9f1cf-e278-4f9c-8584-4ee166c6c01d";
const PEDIDO_WEB_LISTO_PARA_RETIRO_SEED_ID = "ba514a5b-d5e1-47c0-8325-92684b9e9c62";
const PEDIDO_WEB_ENTREGADO_SEED_ID = "e8559382-2cc2-414c-9adf-6afcd5f0552f";
const PEDIDO_WEB_ANULADO_SEED_ID = "d0ebfcb9-743b-412b-89c1-12a38a117ffd";
const PEDIDO_MOSTRADOR_RESERVADO_SEED_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000002";
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";

test(
  "HU-E7 — anulación de orden web no abonada (manual y por TTL) contra una base real",
  { skip: !DATABASE_URL, timeout: 600_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MP_MODO = "simulado";
    process.env.APP_PUBLIC_URL ??= "http://localhost:3000";

    const [
      { prisma },
      anulacion,
      reglas,
      listener,
      carrito,
      checkout,
      pagoWeb,
      mantenimiento,
      { domainEventBus, listenersRegistrados },
      { ServiceError },
      { verificarCadenaIntegridad },
      { obtenerUsuarioCanalWebId },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./anulacion-orden.service.ts"),
      import("./anulacion-orden.reglas.ts"),
      import("../../events/listeners/anulacion-orden.listener.ts"),
      import("./carrito.service.ts"),
      import("./checkout.service.ts"),
      import("./pago-web.service.ts"),
      import("./mantenimiento-programado.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../errors/service-error.ts"),
      import("../auditoria/audit-log.service.ts"),
      import("./usuario-canal-web.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);
    // Asientos de auditoría fire-and-forget: se espera a que la cola se vacíe.
    t.after(async () => {
      await listener.esperarAnulacionesPendientes();
      let anterior = -1;
      for (let intento = 0; intento < 60; intento++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) break;
        anterior = actual;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await prisma.$disconnect();
    });

    // Evidencia de aislamiento: nunca correr contra una base que no sea de test.
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e7] current_database() = ${db}`);

    // Mismo registro que en producción: auditoría y anulación automática se
    // suscriben por el import dinámico de `domain-event-bus.ts`.
    await listenersRegistrados;
    const CANAL_WEB = await obtenerUsuarioCanalWebId();
    const ADMIN = USUARIO_ADMIN_ECOMMERCE_SEED_ID;

    // ── Eventos emitidos ─────────────────────────────────────────────────────
    type Evento = { nombre: string; payload: Record<string, unknown> };
    const eventos: Evento[] = [];
    for (const nombre of ["ecommerce:orden_anulada", "stock:reserva_liberada", "ecommerce:cupon_aplicacion_liberada"] as const) {
      domainEventBus.on(nombre, (payload) => void eventos.push({ nombre, payload: payload as unknown as Record<string, unknown> }));
    }
    const eventosDe = (nombre: string, filtro: (p: Record<string, unknown>) => boolean = () => true) =>
      eventos.filter((e) => e.nombre === nombre && filtro(e.payload));

    // ── Pasarela falsa (mismo arnés que HU-E2) ───────────────────────────────
    const pagosMp = new Map<string, PagoConsultado>();
    const pasarela = {
      consultarPago: async (id: string) => {
        const pago = pagosMp.get(id);
        if (!pago) throw new ServiceError("PAGO_NO_ENCONTRADO");
        return pago;
      },
      cerrarCobro: async () => {},
    };
    function pagoMp(ref: string, estado: "approved" | "rejected", monto: number): string {
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

    // ── Helpers ──────────────────────────────────────────────────────────────
    const conCodigo = (codigo: string) => (err: unknown) => err instanceof ServiceError && err.code === codigo;
    async function esperar<T>(leer: () => Promise<T>, listo: (v: T) => boolean): Promise<T> {
      let valor = await leer();
      for (let intento = 0; intento < 80 && !listo(valor); intento++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        valor = await leer();
      }
      return valor;
    }
    const stockShowroom = async (varianteId: string) =>
      (
        await prisma.stockDeposito.findUniqueOrThrow({
          where: { variante_sku_id_deposito_id: { variante_sku_id: varianteId, deposito_id: DEPOSITO_SHOWROOM_ID } },
        })
      ).cantidad;

    async function crearCupon(valor: number) {
      const codigo = `E7${randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.cuponDescuento.create({
        data: {
          codigo,
          tipo_beneficio: "PORCENTAJE",
          valor,
          vigente_desde: new Date(Date.now() - 86_400_000),
          vigente_hasta: new Date(Date.now() + 86_400_000),
          limite_uso_global: null,
          limite_uso_por_cliente: 5,
        },
      });
      return codigo;
    }

    /** Orden web real (carrito + checkout de E1/E2), uno o varios artículos. */
    async function compra(opciones: { articulos?: number; stock?: number; cantidad?: number; cupon?: string } = {}) {
      const cuenta = await fixtures.crearCuenta(prisma);
      const articulos = [];
      for (let i = 0; i < (opciones.articulos ?? 1); i++) {
        const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: opciones.stock ?? 5, precio: 10000 });
        await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: opciones.cantidad ?? 2 });
        articulos.push(articulo);
      }
      const iniciado = await checkout.iniciarCheckout(cuenta.sesion, opciones.cupon ? { cupon_codigo: opciones.cupon } : {});
      return { cuenta, articulos, iniciado, pv: iniciado.pedido_venta_id };
    }

    const leerOrden = (pedidoVentaId: string) =>
      prisma.pedidoVenta.findUniqueOrThrow({
        where: { id: pedidoVentaId },
        include: { ecommerce: true, items: { include: { reserva: true } }, aplicaciones_cupon: true },
      });

    async function conteos() {
      return {
        pedidos: await prisma.pedidoVenta.count(),
        items: await prisma.pedidoVentaItem.count(),
        reservas: await prisma.reserva.count(),
        aplicaciones: await prisma.cuponAplicacion.count(),
        transacciones: await prisma.transaccionPagoLog.count(),
        extensiones: await prisma.pedidoVentaEcommerce.count(),
      };
    }

    const asientoAnulacion = (pedidoVentaId: string) =>
      esperar(
        () => prisma.auditLog.findMany({ where: { accion: "ecommerce:orden_anulada", registro_id: pedidoVentaId } }),
        (filas) => filas.length > 0,
      );

    /** Vence las reservas de una orden (decisión 6: solo `fecha_expiracion`). */
    async function vencerReservas(pedidoVentaId: string) {
      const items = await prisma.pedidoVentaItem.findMany({ where: { pedido_venta_id: pedidoVentaId }, select: { reserva_id: true } });
      const ids = items.map((i) => i.reserva_id).filter((id): id is string => id !== null);
      await prisma.reserva.updateMany({ where: { id: { in: ids } }, data: { fecha_expiracion: new Date(Date.now() - 60_000) } });
      return ids;
    }

    // ── 1. Manual sobre PAGO_PENDIENTE (CA1, CA3, CA5) ───────────────────────
    await t.test("1. manual PAGO_PENDIENTE: libera reservas y cupón, baja lógica en PedidoVenta y extensión, nada eliminado, evento y ledger", async () => {
      const cupon = await crearCupon(10);
      const { articulos, pv } = await compra({ cupon, stock: 5, cantidad: 2 });
      const varianteId = articulos[0].varianteId;
      assert.equal(await stockShowroom(varianteId), 3, "el checkout congeló 2 unidades");

      const antes = await leerOrden(pv);
      assert.equal(antes.ecommerce?.estado_ecommerce, "PAGO_PENDIENTE");
      assert.ok(antes.ecommerce?.cupon_aplicacion_id, "la orden tiene cupón pendiente");
      const conteosAntes = await conteos();

      const r = await anulacion.anularOrdenNoAbonada(pv, ADMIN, "El cliente desistió");
      assert.deepEqual(r, { pedido_venta_id: pv, estado_ecommerce: "ANULADO", stock_liberado: true });

      // CA1: stock de vuelta a "Disponible" y reserva cerrada, sin eliminar nada.
      assert.equal(await stockShowroom(varianteId), 5, "las 2 unidades volvieron a DISPONIBLE");
      const despues = await leerOrden(pv);
      for (const item of despues.items) {
        assert.ok(item.reserva?.fecha_fin_reserva, "reserva cerrada");
        assert.equal(item.reserva?.is_active, true, "la reserva no se da de baja: queda en el historial");
        assert.equal(item.is_active, true, "el ítem queda intacto");
      }
      const movimiento = await prisma.movimientoStock.findFirst({
        where: { comprobante_referencia: `LIBERACION-ANULACION_ORDEN-${despues.items[0].reserva_id}` },
        include: { items: true },
      });
      assert.equal(movimiento?.tipo_movimiento, "INGRESO");
      assert.equal(movimiento?.items[0].estado_destino, "DISPONIBLE");

      // CA3: baja lógica con los cuatro campos en PedidoVenta y extensión.
      assert.equal(despues.estado, "ANULADO");
      assert.equal(despues.is_active, false);
      assert.ok(despues.deleted_at);
      assert.equal(despues.deleted_by, ADMIN);
      assert.equal(despues.deletion_reason, "El cliente desistió");
      assert.equal(despues.ecommerce?.estado_ecommerce, "ANULADO");
      assert.equal(despues.ecommerce?.is_active, false);
      assert.ok(despues.ecommerce?.deleted_at);
      assert.equal(despues.ecommerce?.deleted_by, ADMIN);
      assert.equal(despues.ecommerce?.deletion_reason, "El cliente desistió");

      // D5(b): la aplicación pendiente dejó de ocupar capacidad (baja lógica).
      const aplicacion = despues.aplicaciones_cupon[0];
      assert.equal(aplicacion.is_active, false);
      assert.equal(aplicacion.confirmada, false);
      assert.equal(aplicacion.deleted_by, CANAL_WEB);

      // Nada eliminado (Regla N.° 1).
      assert.deepEqual(await conteos(), conteosAntes, "conteos idénticos antes y después");

      // Eventos post-COMMIT.
      assert.deepEqual(eventosDe("ecommerce:orden_anulada", (p) => p.pedido_venta_id === pv).map((e) => e.payload), [
        { pedido_venta_id: pv, usuario_id: ADMIN, deletion_reason: "El cliente desistió", automatico: false },
      ]);
      const liberadas = eventosDe("stock:reserva_liberada", (p) => p.reserva_id === despues.items[0].reserva_id);
      assert.deepEqual(liberadas.map((e) => e.payload.motivo_liberacion), ["ANULACION_ORDEN"]);
      assert.equal(eventosDe("ecommerce:cupon_aplicacion_liberada", (p) => p.pedido_venta_id === pv).length, 1);

      // CA5: asiento sensible en el ledger, con la cadena SHA-256 íntegra.
      const [asiento] = await asientoAnulacion(pv);
      assert.equal(asiento.usuario_id, ADMIN);
      assert.equal(asiento.tabla_afectada, "pedidos_venta");
      assert.deepEqual(asiento.valor_nuevo, {
        estado_ecommerce: "ANULADO",
        is_active: false,
        deletion_reason: "El cliente desistió",
        automatico: false,
      });
      assert.match(asiento.hash_actual, /^[0-9a-f]{64}$/);
      const liberacionAuditada = await esperar(
        () => prisma.auditLog.findFirst({ where: { accion: "RESERVA_LIBERADA", registro_id: despues.items[0].reserva_id! } }),
        (fila) => fila !== null,
      );
      assert.deepEqual((liberacionAuditada?.valor_nuevo as Record<string, unknown>).motivo_liberacion, "ANULACION_ORDEN");
      assert.equal((await verificarCadenaIntegridad()).integra, true);
    });

    // ── 2. Manual sobre PAGO_RECHAZADO ───────────────────────────────────────
    await t.test("2. manual PAGO_RECHAZADO (flujo real E2): solo la extensión; el PedidoVenta conserva la baja de E2; stock_liberado false", async () => {
      const { articulos, iniciado, pv } = await compra({ stock: 4, cantidad: 1 });
      const rechazo = await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "rejected", iniciado.total), pasarela);
      assert.equal(rechazo.resultado, "RECHAZADO");
      const tras = await leerOrden(pv);
      assert.equal(tras.estado, "ANULADO");
      assert.equal(tras.ecommerce?.estado_ecommerce, "PAGO_RECHAZADO");
      const stockTrasRechazo = await stockShowroom(articulos[0].varianteId);
      assert.equal(stockTrasRechazo, 4, "E2 ya liberó el stock");
      const conteosAntes = await conteos();

      const r = await anulacion.anularOrdenNoAbonada(pv, ADMIN, "Orden rechazada sin reintento");
      assert.deepEqual(r, { pedido_venta_id: pv, estado_ecommerce: "ANULADO", stock_liberado: false });

      const despues = await leerOrden(pv);
      assert.equal(despues.deleted_by, tras.deleted_by, "deleted_by de E2 intacto");
      assert.equal(despues.deleted_by, CANAL_WEB);
      assert.equal(despues.deletion_reason, tras.deletion_reason, "deletion_reason de E2 intacto");
      assert.equal(despues.deleted_at?.toISOString(), tras.deleted_at?.toISOString());
      assert.equal(despues.ecommerce?.estado_ecommerce, "ANULADO");
      assert.equal(despues.ecommerce?.is_active, false);
      assert.equal(despues.ecommerce?.deleted_by, ADMIN);
      assert.equal(despues.ecommerce?.deletion_reason, "Orden rechazada sin reintento");
      assert.equal(await stockShowroom(articulos[0].varianteId), stockTrasRechazo, "no se toca stock");
      assert.deepEqual(await conteos(), conteosAntes);
      assert.equal(eventosDe("stock:reserva_liberada", (p) => p.reserva_id === despues.items[0].reserva_id && p.motivo_liberacion === "ANULACION_ORDEN").length, 0);
      const [asiento] = await asientoAnulacion(pv);
      assert.equal(asiento.usuario_id, ADMIN);
    });

    await t.test("2b. manual PAGO_RECHAZADO con PedidoVenta todavía RESERVADO (fixture del seed): también se anula el PedidoVenta (decisión 1)", async () => {
      const tras = await leerOrden(PEDIDO_WEB_PAGO_RECHAZADO_SEED_ID);
      assert.equal(tras.estado, "RESERVADO", "hallazgo: el seed no refleja el flujo real de E2");
      assert.equal(tras.is_active, true);
      const r = await anulacion.anularOrdenNoAbonada(PEDIDO_WEB_PAGO_RECHAZADO_SEED_ID, ADMIN, "Fixture rechazado sin reintento");
      assert.equal(r.stock_liberado, false, "su reserva ya estaba cerrada");
      const despues = await leerOrden(PEDIDO_WEB_PAGO_RECHAZADO_SEED_ID);
      assert.equal(despues.estado, "ANULADO");
      assert.equal(despues.is_active, false);
      assert.equal(despues.deleted_by, ADMIN);
      assert.equal(despues.deletion_reason, "Fixture rechazado sin reintento");
      assert.equal(despues.ecommerce?.estado_ecommerce, "ANULADO");
    });

    // ── 3. 409 y 404 ─────────────────────────────────────────────────────────
    await t.test("3. 409 TRANSICION_INVALIDA en los 7 estados no anulables y en una segunda anulación; 404 PEDIDO_WEB_NO_ENCONTRADO", async () => {
      const intentar = (id: string) => anulacion.anularOrdenNoAbonada(id, ADMIN, "Intento inválido");
      const esperado409 = (err: unknown) => {
        assert.ok(conCodigo("TRANSICION_INVALIDA")(err));
        assert.equal((err as Error).message, reglas.MENSAJE_TRANSICION_INVALIDA_ANULACION);
        return true;
      };

      // Estados de reposo inexistentes por servicio: orden real pagada y estado fijado (ver cabecera).
      for (const estado of ["PAGO_CONFIRMADO", "CANCELADO", "VENCIDO_SIN_RETIRO"] as const) {
        const { iniciado, pv } = await compra({ cantidad: 1 });
        const pago = await pagoWeb.procesarNotificacionPago(pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", iniciado.total), pasarela);
        assert.equal(pago.resultado, "CONFIRMADO");
        await prisma.pedidoVentaEcommerce.update({ where: { pedido_venta_id: pv }, data: { estado_ecommerce: estado } });
        const antes = await leerOrden(pv);
        await assert.rejects(intentar(pv), esperado409, estado);
        const despues = await leerOrden(pv);
        assert.equal(despues.ecommerce?.estado_ecommerce, estado, `${estado}: sin cambios`);
        assert.equal(despues.estado, antes.estado);
        assert.equal(despues.is_active, true);
      }

      for (const [estado, id] of [
        ["EN_PREPARACION", PEDIDO_WEB_EN_PREPARACION_SEED_ID],
        ["LISTO_PARA_RETIRO", PEDIDO_WEB_LISTO_PARA_RETIRO_SEED_ID],
        ["ENTREGADO", PEDIDO_WEB_ENTREGADO_SEED_ID],
        ["ANULADO (fixture PEDIDO_WEB_ANULADO_IDS)", PEDIDO_WEB_ANULADO_SEED_ID],
      ] as const) {
        const antes = await leerOrden(id);
        await assert.rejects(intentar(id), esperado409, estado);
        const despues = await leerOrden(id);
        assert.equal(despues.ecommerce?.estado_ecommerce, antes.ecommerce?.estado_ecommerce, estado);
        assert.equal(despues.ecommerce?.deletion_reason, antes.ecommerce?.deletion_reason, estado);
      }

      // Segunda anulación de la misma orden.
      const { pv } = await compra({ cantidad: 1 });
      await anulacion.anularOrdenNoAbonada(pv, ADMIN, "Primera");
      await assert.rejects(intentar(pv), esperado409);
      assert.equal((await leerOrden(pv)).ecommerce?.deletion_reason, "Primera", "la segunda no pisa la baja");

      // 404: inexistente y pedido de mostrador.
      await assert.rejects(intentar(randomUUID()), conCodigo("PEDIDO_WEB_NO_ENCONTRADO"));
      await assert.rejects(intentar(PEDIDO_MOSTRADOR_RESERVADO_SEED_ID), conCodigo("PEDIDO_WEB_NO_ENCONTRADO"));
      const mostrador = await leerOrden(PEDIDO_MOSTRADOR_RESERVADO_SEED_ID);
      assert.equal(mostrador.estado, "RESERVADO");
      assert.equal(mostrador.is_active, true);
    });

    // ── 4. Concurrencia con el pago (D9) ─────────────────────────────────────
    await t.test("4. concurrencia anulación vs. confirmación de pago: gana exactamente una, estado final consistente", async () => {
      const ganadores = { anulacion: 0, pago: 0 };
      for (let ronda = 0; ronda < 8; ronda++) {
        const { articulos, iniciado, pv } = await compra({ stock: 5, cantidad: 2 });
        const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "approved", iniciado.total);
        // Rondas impares: el webhook arranca primero (cubre la rama "gana el pago").
        const pausaAnulacion = ronda % 2 === 1 ? 40 : 0;
        const [anul, pago] = await Promise.allSettled([
          new Promise((resolve) => setTimeout(resolve, pausaAnulacion)).then(() =>
            anulacion.anularOrdenNoAbonada(pv, ADMIN, `Carrera ${ronda}`),
          ),
          pagoWeb.procesarNotificacionPago(pid, pasarela),
        ]);
        assert.equal(pago.status, "fulfilled", "el webhook nunca lanza en esta carrera");
        const final = await leerOrden(pv);
        const stock = await stockShowroom(articulos[0].varianteId);
        if (anul.status === "fulfilled") {
          ganadores.anulacion++;
          assert.equal(pago.status === "fulfilled" && pago.value.resultado, "ANOMALIA");
          assert.equal(pago.status === "fulfilled" && pago.value.motivo, "PAGO_TARDIO");
          assert.equal(final.estado, "ANULADO");
          assert.equal(final.ecommerce?.estado_ecommerce, "ANULADO");
          assert.equal(final.fecha_facturacion, null, "no hay factura");
          assert.equal(stock, 5, "stock devuelto");
        } else {
          ganadores.pago++;
          assert.ok(conCodigo("TRANSICION_INVALIDA")(anul.reason), String(anul.reason));
          assert.equal(pago.status === "fulfilled" && pago.value.resultado, "CONFIRMADO");
          assert.equal(final.estado, "FACTURADO");
          assert.equal(final.is_active, true);
          assert.equal(final.ecommerce?.estado_ecommerce, "PAGO_CONFIRMADO");
          assert.equal(final.ecommerce?.is_active, true);
          assert.equal(stock, 3, "las unidades quedaron vendidas");
        }
      }
      console.log(`[hu-e7] carrera anulación/pago: ${JSON.stringify(ganadores)}`);
      assert.equal(ganadores.anulacion + ganadores.pago, 8);
    });

    await t.test("4b. conflicto con rechazarPago (orden de bloqueo inverso): reintento local, anulada y liberada una sola vez", async (st) => {
      // Captura de los avisos de reintento (solo pedido e intento, sin PII).
      const reintentos: Record<string, unknown>[] = [];
      const warnOriginal = console.warn;
      st.after(() => {
        console.warn = warnOriginal;
      });
      console.warn = (...args: unknown[]) => {
        if (String(args[0]).startsWith("[HU-E7] Reintento")) reintentos.push(args[1] as Record<string, unknown>);
        else warnOriginal(...args);
      };

      const resultados: string[] = [];
      for (let ronda = 0; ronda < 12; ronda++) {
        const { articulos, iniciado, pv } = await compra({ stock: 5, cantidad: 2 });
        const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "rejected", iniciado.total);
        const [anul, rechazo] = await Promise.allSettled([
          anulacion.anularOrdenNoAbonada(pv, ADMIN, `Carrera rechazo ${ronda}`),
          pagoWeb.procesarNotificacionPago(pid, pasarela),
        ]);
        assert.equal(anul.status, "fulfilled", `la anulación siempre termina: ${anul.status === "rejected" ? String(anul.reason) : ""}`);
        let resultadoRechazo = rechazo.status === "fulfilled" ? rechazo.value.resultado : "LANZO";
        if (rechazo.status === "rejected") {
          // Víctima del deadlock: Mercado Pago reintenta y la notificación ya no tiene efecto.
          resultadoRechazo += `→${(await pagoWeb.procesarNotificacionPago(pid, pasarela)).resultado}`;
        }
        const reintentosRonda = reintentos.filter((r) => r.pedido_venta_id === pv).length;
        resultados.push(`${anul.status === "fulfilled" ? anul.value.stock_liberado : "-"}/${resultadoRechazo}/reintentos=${reintentosRonda}`);

        const final = await leerOrden(pv);
        assert.equal(final.estado, "ANULADO");
        assert.equal(final.is_active, false);
        assert.equal(final.ecommerce?.estado_ecommerce, "ANULADO");
        assert.equal(final.ecommerce?.is_active, false);
        assert.equal(await stockShowroom(articulos[0].varianteId), 5, "stock devuelto exactamente una vez");
        const movimientos = await prisma.movimientoStock.count({
          where: { comprobante_referencia: { endsWith: final.items[0].reserva_id! }, tipo_movimiento: "INGRESO" },
        });
        assert.equal(movimientos, 1, "un único INGRESO compensatorio");
        assert.equal(eventosDe("ecommerce:orden_anulada", (p) => p.pedido_venta_id === pv).length, 1, "evento emitido una sola vez");
      }
      console.log(`[hu-e7] carrera anulación/rechazo (stock_liberado/rechazo/reintentos): ${resultados.join(", ")}`);
      assert.ok(reintentos.length >= 1, "en 12 rondas hubo al menos un deadlock reintentado");
      for (const r of reintentos) assert.deepEqual(Object.keys(r).sort(), ["intento", "pedido_venta_id"], "el aviso no lleva PII");
    });

    // ── 5. Automática por TTL (CA4) ──────────────────────────────────────────
    await t.test("5. TTL real: anula la orden web vencida (una sola vez, varios ítems) y no toca vigentes, mostrador ni otros estados", async () => {
      // Orden web de dos ítems con reservas vencidas.
      const vencida = await compra({ articulos: 2, stock: 5, cantidad: 2 });
      await vencerReservas(vencida.pv);
      // Orden web con reserva vigente.
      const vigente = await compra({ stock: 5, cantidad: 1 });
      // Pedido de mostrador con reserva vencida (Módulo A la libera; E7 no lo toca).
      const mostradorAntes = await leerOrden(PEDIDO_MOSTRADOR_RESERVADO_SEED_ID);
      await vencerReservas(PEDIDO_MOSTRADOR_RESERVADO_SEED_ID);
      // Extensión en otro estado (EN_PREPARACION) cuya reserva se cerró por venta.
      const enPreparacionAntes = await leerOrden(PEDIDO_WEB_EN_PREPARACION_SEED_ID);

      const resultado = await mantenimiento.ejecutarMantenimientoProgramado(new Date());
      assert.equal(resultado.reservas.ok, true);
      const liberadasJob = resultado.reservas.ok ? resultado.reservas.valor.liberadas.map((r) => r.reserva_id) : [];
      for (const item of vencida.iniciado ? (await leerOrden(vencida.pv)).items : []) {
        assert.ok(liberadasJob.includes(item.reserva_id!), "el job real liberó cada reserva de la orden");
      }
      await listener.esperarAnulacionesPendientes();

      const anulada = await leerOrden(vencida.pv);
      assert.equal(anulada.estado, "ANULADO");
      assert.equal(anulada.is_active, false);
      assert.equal(anulada.deleted_by, CANAL_WEB);
      assert.equal(anulada.deletion_reason, reglas.MOTIVO_ANULACION_TTL);
      assert.equal(anulada.ecommerce?.estado_ecommerce, "ANULADO");
      assert.equal(anulada.ecommerce?.is_active, false);
      assert.equal(anulada.ecommerce?.deleted_by, CANAL_WEB);
      assert.equal(anulada.ecommerce?.deletion_reason, reglas.MOTIVO_ANULACION_TTL);
      for (const articulo of vencida.articulos) {
        assert.equal(await stockShowroom(articulo.varianteId), 5, "stock DISPONIBLE");
      }
      const emitidos = eventosDe("ecommerce:orden_anulada", (p) => p.pedido_venta_id === vencida.pv);
      assert.equal(emitidos.length, 1, "una sola anulación para una orden de varios ítems");
      assert.deepEqual(emitidos[0].payload, {
        pedido_venta_id: vencida.pv,
        deletion_reason: "Reserva vencida sin pago (TTL)",
        automatico: true,
      });
      assert.equal("usuario_id" in emitidos[0].payload, false, "usuario_id ausente en la vía automática");
      const asientos = await asientoAnulacion(vencida.pv);
      assert.equal(asientos.length, 1);
      assert.equal(asientos[0].usuario_id, null, "auditoría automática con usuario_id null (decisión 4)");
      assert.equal((asientos[0].valor_nuevo as Record<string, unknown>).automatico, true);

      // No se tocan: vigente, mostrador, otro estado.
      const vigenteDespues = await leerOrden(vigente.pv);
      assert.equal(vigenteDespues.ecommerce?.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(vigenteDespues.is_active, true);
      assert.equal(vigenteDespues.items[0].reserva?.fecha_fin_reserva, null);
      const mostradorDespues = await leerOrden(PEDIDO_MOSTRADOR_RESERVADO_SEED_ID);
      assert.equal(mostradorDespues.estado, mostradorAntes.estado);
      assert.equal(mostradorDespues.is_active, true);
      assert.equal(mostradorDespues.deleted_by, null);
      assert.ok(mostradorDespues.items.some((i) => i.reserva?.fecha_fin_reserva), "Módulo A sí liberó su reserva vencida");
      assert.equal(eventosDe("ecommerce:orden_anulada", (p) => p.pedido_venta_id === PEDIDO_MOSTRADOR_RESERVADO_SEED_ID).length, 0);

      // Extensión en otro estado: el listener recibe un TTL_VENCIDO de su reserva y lo ignora.
      await listener.manejarReservaLiberada({
        reserva_id: enPreparacionAntes.items[0].reserva_id!,
        motivo_liberacion: "TTL_VENCIDO",
        variante_sku_id: enPreparacionAntes.items[0].variante_sku_id,
        cantidad: 1,
      });
      const enPreparacionDespues = await leerOrden(PEDIDO_WEB_EN_PREPARACION_SEED_ID);
      assert.equal(enPreparacionDespues.ecommerce?.estado_ecommerce, "EN_PREPARACION");
      assert.equal(enPreparacionDespues.ecommerce?.is_active, true);

      // Otro motivo de liberación sobre una orden pendiente: se ignora.
      await listener.manejarReservaLiberada({
        reserva_id: vigenteDespues.items[0].reserva_id!,
        motivo_liberacion: "PAGO_RECHAZADO",
        variante_sku_id: vigenteDespues.items[0].variante_sku_id,
        cantidad: 1,
      });
      assert.equal((await leerOrden(vigente.pv)).ecommerce?.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal((await verificarCadenaIntegridad()).integra, true);
    });

    await t.test("5b. TTL con una reserva vencida y otra vigente en la misma orden: la vía automática libera también la vigente (decisión 2)", async () => {
      const orden = await compra({ articulos: 2, stock: 5, cantidad: 1 });
      const [primera] = (await leerOrden(orden.pv)).items;
      await prisma.reserva.update({ where: { id: primera.reserva_id! }, data: { fecha_expiracion: new Date(Date.now() - 60_000) } });
      await mantenimiento.ejecutarMantenimientoProgramado(new Date());
      await listener.esperarAnulacionesPendientes();
      const final = await leerOrden(orden.pv);
      assert.equal(final.ecommerce?.estado_ecommerce, "ANULADO");
      for (const item of final.items) assert.ok(item.reserva?.fecha_fin_reserva, "ninguna reserva quedó congelada");
      for (const articulo of orden.articulos) assert.equal(await stockShowroom(articulo.varianteId), 5);
      const segunda = final.items.find((i) => i.id !== primera.id)!;
      assert.deepEqual(
        eventosDe("stock:reserva_liberada", (p) => p.reserva_id === segunda.reserva_id).map((e) => e.payload.motivo_liberacion),
        ["ANULACION_ORDEN"],
      );
    });

    // ── 6. Robustez del listener ─────────────────────────────────────────────
    await t.test("6. si la anulación automática falla, el emisor no se rompe y se loguea solo el código", async (st) => {
      const errores: unknown[][] = [];
      const original = console.error;
      st.after(() => {
        console.error = original;
      });
      console.error = (...args: unknown[]) => void errores.push(args);
      const payload = { reserva_id: randomUUID(), motivo_liberacion: "TTL_VENCIDO" as const, variante_sku_id: randomUUID(), cantidad: 1 };

      // Fallo de dominio con un mensaje que contiene datos: no debe loguearse.
      await listener.manejarReservaLiberada(payload, async () => {
        throw new ServiceError("CANAL_WEB_SIN_USUARIO_SISTEMA", "mensaje con PII juan.perez@example.com");
      });
      // Fallo inesperado sin código.
      await listener.manejarReservaLiberada(payload, async () => {
        throw new Error("detalle interno con DNI 12345678");
      });
      console.error = original;
      assert.equal(errores.length, 2);
      const logueado = JSON.stringify(errores);
      assert.match(logueado, /CANAL_WEB_SIN_USUARIO_SISTEMA/);
      assert.match(logueado, /ERROR_ANULACION_AUTOMATICA/);
      assert.doesNotMatch(logueado, /juan\.perez|12345678|mensaje con PII|detalle interno/);

      // El emisor real (bus) no lanza aunque la reserva no exista.
      assert.doesNotThrow(() => domainEventBus.emit("stock:reserva_liberada", payload));
      await listener.esperarAnulacionesPendientes();
    });

    // ── 7. Auditoría (resumen) ───────────────────────────────────────────────
    await t.test("7. ledger: asientos manual y automático con el actor correcto y cadena íntegra", async () => {
      const manuales = await prisma.auditLog.count({ where: { accion: "ecommerce:orden_anulada", usuario_id: ADMIN } });
      const automaticos = await prisma.auditLog.count({ where: { accion: "ecommerce:orden_anulada", usuario_id: null } });
      assert.ok(manuales >= 3, `manuales=${manuales}`);
      assert.ok(automaticos >= 2, `automaticos=${automaticos}`);
      const verificacion = await verificarCadenaIntegridad();
      assert.equal(verificacion.integra, true);
      console.log(`[hu-e7] ledger: ${verificacion.registros_verificados} registros verificados, manuales=${manuales}, automáticos=${automaticos}`);
    });
  },
);
