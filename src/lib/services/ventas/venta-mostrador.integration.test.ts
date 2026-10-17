import assert from "node:assert/strict";
import test from "node:test";

/**
 * Test de integración de HU-B1 contra una base real (mismo patrón que
 * `turno-caja.integration.test.ts`/`presupuesto.integration.test.ts`: `skip`
 * si no hay `HU_B1_INTEGRATION_DATABASE_URL`, imports dinámicos porque
 * `venta-mostrador.service.ts` usa `import "server-only"`).
 *
 * Corre con: `npm run test:integration:b1` (opt-in, requiere una base
 * accesible con el seed ya aplicado).
 *
 * Usa `supervisor.ventas.seed` (no `cajero.seed`) para todo el flujo ad-hoc:
 * `cajero.seed` ya tiene un `TurnoCaja` compartido permanentemente abierto
 * (`TURNO_CAJA_ABIERTO_ID`, fixture que otros tests asumen abierto — mismo
 * criterio documentado en `turno-caja.integration.test.ts`) que este archivo
 * no debe tocar. `SUPERVISOR_VENTAS` hereda `ventas:registrar_venta_mostrador`
 * de `CAJERO_POS` (HU-B8, seed real) — mismo criterio ya usado por
 * `turno-caja.integration.test.ts` para sus escenarios ad-hoc.
 *
 * Consume una pequeña cantidad de stock REAL de `VARIANTE_BORCEGOS_1_ID`/
 * `VARIANTE_BORCEGOS_2_ID` en el depósito central por cada corrida (mismo
 * criterio ya aceptado por `presupuesto.integration.test.ts` contra
 * `VARIANTE_CAMISA_TACTICA_2_ID`) — ambas variantes tienen stock inicial
 * amplio (30 y 14 unidades) para tolerar reejecuciones.
 */

const DATABASE_URL = process.env.HU_B1_INTEGRATION_DATABASE_URL;

// IDs fijos del seed (prisma/seed.ts).
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";
const DEPOSITO_SEED_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const VARIANTE_BORCEGOS_1_ID = "864c2765-cbdd-41eb-837a-e12814b62868";
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

test(
  "HU-B1 integra el flujo completo de venta de mostrador contra una base real",
  { skip: !DATABASE_URL, timeout: 30_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      ventaMostrador,
      turnoCaja,
      { ServiceError },
      { iniciarAuditLogListener },
      { domainEventBus },
      { verificarCadenaIntegridad },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./venta-mostrador.service.ts"),
      import("./turno-caja.service.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../auditoria/audit-log.service.ts"),
    ]);
    t.after(async () => prisma.$disconnect());
    iniciarAuditLogListener();

    async function esperarAuditLog(pedidoVentaId: string, accion: string) {
      let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
      for (let intento = 0; intento < 20 && filas.length === 0; intento++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        filas = await prisma.auditLog.findMany({
          where: { tabla_afectada: "pedidos_venta", registro_id: pedidoVentaId, accion },
        });
      }
      return filas;
    }

    // ── Setup idempotente: supervisor.ventas.seed arranca SIN turno abierto,
    //    sin importar el orden de ejecución respecto de otros archivos de
    //    test (ej. turno-caja.integration.test.ts) ────────────────────────
    await prisma.turnoCaja.updateMany({
      where: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID, fecha_cierre: null },
      data: { fecha_cierre: new Date(), saldo_esperado: 0, conteo_fisico_declarado: 0, diferencia: 0 },
    });

    // ── 1. Precondición dura: SIN turno abierto → 422, sin tocar stock ─────
    await t.test(
      "registrarVentaMostrador rechaza sin turno abierto (422 SIN_TURNO_ABIERTO), sin tocar stock ni cobro",
      async () => {
        const stockAntes = await prisma.stockDeposito.findFirstOrThrow({
          where: { variante_sku_id: VARIANTE_BORCEGOS_1_ID, deposito_id: DEPOSITO_SEED_ID },
          select: { cantidad: true },
        });

        await assert.rejects(
          () =>
            ventaMostrador.registrarVentaMostrador(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
              items: [
                {
                  variante_sku_id: VARIANTE_BORCEGOS_1_ID,
                  deposito_id: DEPOSITO_SEED_ID,
                  cantidad: 1,
                  precio_unitario: 10000,
                },
              ],
              medios_pago: [{ medio: "EFECTIVO", importe: 10000 }],
              tipo_comprobante: "TICKET",
            }),
          (err: unknown) => err instanceof ServiceError && err.code === "SIN_TURNO_ABIERTO",
        );

        const stockDespues = await prisma.stockDeposito.findFirstOrThrow({
          where: { variante_sku_id: VARIANTE_BORCEGOS_1_ID, deposito_id: DEPOSITO_SEED_ID },
          select: { cantidad: true },
        });
        assert.equal(stockDespues.cantidad, stockAntes.cantidad);
      },
    );

    // ── Turno ad-hoc para el resto de los escenarios ────────────────────────
    const turno = await turnoCaja.abrirTurnoCaja(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
      fondo_fijo_inicial: 1000,
    });

    // ── 2. Venta simple, un solo medio de pago: factura directo ────────────
    let pedidoSimpleId = "";
    await t.test(
      "registrarVentaMostrador: venta simple con un solo medio de pago factura directo y emite comprobante",
      async () => {
        let eventoEmitido: { pedido_venta_id: string; total: number } | null = null;
        domainEventBus.once("venta:registrada", (payload) => {
          eventoEmitido = payload;
        });

        const resultado = await ventaMostrador.registrarVentaMostrador(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
          items: [
            {
              variante_sku_id: VARIANTE_BORCEGOS_1_ID,
              deposito_id: DEPOSITO_SEED_ID,
              cantidad: 1,
              precio_unitario: 40000,
            },
          ],
          medios_pago: [{ medio: "EFECTIVO", importe: 40000 }],
          tipo_comprobante: "TICKET",
        });
        pedidoSimpleId = resultado.pedido_venta_id;

        assert.equal(resultado.total, 40000);
        assert.ok(resultado.comprobante_id);
        assert.equal(resultado.tipo_comprobante, "TICKET");
        assert.match(resultado.numero_venta, /^V-\d{4}-\d{6}$/);

        const pedidoDb = await prisma.pedidoVenta.findUniqueOrThrow({
          where: { id: pedidoSimpleId },
          select: { estado: true, total: true, turno_caja_id: true, fecha_facturacion: true },
        });
        assert.equal(pedidoDb.estado, "FACTURADO");
        assert.equal(pedidoDb.turno_caja_id, turno.turno_caja_id);
        assert.ok(pedidoDb.fecha_facturacion);

        const comprobanteDb = await prisma.comprobanteFiscal.findFirst({
          where: { pedido_venta_id: pedidoSimpleId },
        });
        assert.ok(comprobanteDb);
        assert.equal(comprobanteDb!.es_simulado, true);
        assert.equal(comprobanteDb!.cae_simulado.length, 14);
        assert.match(comprobanteDb!.qr_data_url, /^data:image\/png;base64,/);

        assert.ok(eventoEmitido);
        const evento = eventoEmitido as unknown as { pedido_venta_id: string; total: number };
        assert.equal(evento.pedido_venta_id, pedidoSimpleId);
        assert.equal(evento.total, 40000);

        const filasAudit = await esperarAuditLog(pedidoSimpleId, "VENTA_MOSTRADOR_REGISTRADA");
        assert.equal(filasAudit.length, 1);
      },
    );

    // ── 3. Stock: DISPONIBLE → VENDIDO vía Reserva/confirmar, no un camino
    //    paralelo (spec §2.1: exclusividad de Módulo A) ─────────────────────
    await t.test(
      "el stock de la venta simple pasó de DISPONIBLE a VENDIDO vía Reserva confirmada de Módulo A",
      async () => {
        const item = await prisma.pedidoVentaItem.findFirstOrThrow({
          where: { pedido_venta_id: pedidoSimpleId },
          select: { reserva_id: true, cantidad_facturada: true, cantidad_entregada: true },
        });
        assert.ok(item.reserva_id);
        assert.equal(item.cantidad_facturada, 1);
        assert.equal(item.cantidad_entregada, 1);

        const reserva = await prisma.reserva.findUniqueOrThrow({
          where: { id: item.reserva_id! },
          select: { fecha_fin_reserva: true, origen_reserva: true },
        });
        assert.equal(reserva.origen_reserva, "SENIA"); // decisión 0.5 de task_relos.md
        assert.ok(reserva.fecha_fin_reserva); // cerrada = confirmada, no queda RESERVADO activa

        const movimiento = await prisma.movimientoStock.findFirst({
          where: { comprobante_referencia: `RESERVA-CONFIRMADA-${item.reserva_id}` },
          include: { items: true },
        });
        assert.ok(movimiento);
        assert.equal(movimiento!.venta_id, pedidoSimpleId);
        assert.equal(movimiento!.items[0]?.estado_origen, "RESERVADO");
        assert.equal(movimiento!.items[0]?.estado_destino, "VENDIDO");
      },
    );

    // ── 4. Cobro multimedio combinado ───────────────────────────────────────
    await t.test("registrarVentaMostrador: cobro multimedio combinado (2 medios) factura directo", async () => {
      const resultado = await ventaMostrador.registrarVentaMostrador(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
        items: [
          {
            variante_sku_id: VARIANTE_BORCEGOS_1_ID,
            deposito_id: DEPOSITO_SEED_ID,
            cantidad: 2,
            precio_unitario: 20000,
          },
        ],
        medios_pago: [
          { medio: "EFECTIVO", importe: 15000 },
          { medio: "TARJETA", importe: 25000, referencia: "LOTE-0042" },
        ],
        tipo_comprobante: "FACTURA_B",
      });

      assert.equal(resultado.total, 40000);
      assert.ok(resultado.comprobante_id);

      const medios = await prisma.ventaMedioPago.findMany({
        where: { pedido_venta_id: resultado.pedido_venta_id },
        select: { medio: true, importe: true },
      });
      assert.equal(medios.length, 2);
      const total = medios.reduce((acc, m) => acc + m.importe.toNumber(), 0);
      assert.equal(total, 40000);
    });

    // ── 5. Descuento DENTRO del margen (5% == MARGEN_DESCUENTO_CAJERO_POS):
    //    factura directo, sin ítem pendiente ────────────────────────────────
    await t.test(
      "registrarVentaMostrador: descuento dentro del margen (5%) factura directo, sin ítem pendiente",
      async () => {
        // 30000 * 0.95 = 28500.
        const resultado = await ventaMostrador.registrarVentaMostrador(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
          items: [
            {
              variante_sku_id: VARIANTE_BORCEGOS_1_ID,
              deposito_id: DEPOSITO_SEED_ID,
              cantidad: 1,
              precio_unitario: 30000,
              descuento_porcentual: 5,
            },
          ],
          medios_pago: [{ medio: "EFECTIVO", importe: 28500 }],
          tipo_comprobante: "TICKET",
        });

        assert.equal(resultado.total, 28500);
        assert.ok(resultado.comprobante_id);

        const item = await prisma.pedidoVentaItem.findFirstOrThrow({
          where: { pedido_venta_id: resultado.pedido_venta_id },
        });
        assert.equal(item.requiere_autorizacion, false);
        assert.ok(item.reserva_id);
      },
    );

    // ── 6. Descuento FUERA del margen: PedidoVenta RESERVADO, ítem marcado,
    //    SIN comprobante, SIN reserva de stock para ese ítem, pero el cobro
    //    completo SÍ se persiste (DECISIÓN B/C, task_relos.md) ──────────────
    await t.test(
      "registrarVentaMostrador: descuento fuera de margen (10%) deja RESERVADO, ítem marcado, sin comprobante",
      async () => {
        // 30000 * 0.9 = 27000 — el cobro se recibe completo igual.
        const resultado = await ventaMostrador.registrarVentaMostrador(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
          items: [
            {
              variante_sku_id: VARIANTE_BORCEGOS_1_ID,
              deposito_id: DEPOSITO_SEED_ID,
              cantidad: 1,
              precio_unitario: 30000,
              descuento_porcentual: 10,
            },
          ],
          medios_pago: [{ medio: "EFECTIVO", importe: 27000 }],
          tipo_comprobante: "TICKET",
        });

        assert.equal(resultado.total, 27000);
        assert.equal(resultado.comprobante_id, null);

        const pedidoDb = await prisma.pedidoVenta.findUniqueOrThrow({
          where: { id: resultado.pedido_venta_id },
          select: { estado: true, fecha_facturacion: true },
        });
        assert.equal(pedidoDb.estado, "RESERVADO");
        assert.equal(pedidoDb.fecha_facturacion, null);

        const item = await prisma.pedidoVentaItem.findFirstOrThrow({
          where: { pedido_venta_id: resultado.pedido_venta_id },
        });
        assert.equal(item.requiere_autorizacion, true);
        assert.equal(item.autorizado_por_id, null);
        assert.equal(item.reserva_id, null); // sin stock congelado para el ítem pendiente
        assert.equal(item.cantidad_facturada, 0);
        assert.equal(item.cantidad_entregada, 0);

        const comprobante = await prisma.comprobanteFiscal.findFirst({
          where: { pedido_venta_id: resultado.pedido_venta_id },
        });
        assert.equal(comprobante, null);

        // El cobro completo SÍ se persistió — no se retiene el dinero ya
        // recibido por el Cajero (DECISIÓN B).
        const medios = await prisma.ventaMedioPago.findMany({
          where: { pedido_venta_id: resultado.pedido_venta_id },
        });
        assert.equal(medios.length, 1);
        assert.equal(medios[0]?.importe.toNumber(), 27000);
      },
    );

    // ── 7. Venta con 2 ítems: uno dentro y otro fuera de margen — espera
    //    POR ÍTEM, nunca bloquea el pedido completo (DECISIÓN B) ────────────
    await t.test(
      "registrarVentaMostrador: 2 ítems (uno dentro, otro fuera de margen) — reserva SOLO para el ítem resuelto",
      async () => {
        const resultado = await ventaMostrador.registrarVentaMostrador(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
          items: [
            {
              variante_sku_id: VARIANTE_BORCEGOS_1_ID,
              deposito_id: DEPOSITO_SEED_ID,
              cantidad: 1,
              precio_unitario: 10000,
            },
            {
              variante_sku_id: VARIANTE_BORCEGOS_2_ID,
              deposito_id: DEPOSITO_SEED_ID,
              cantidad: 1,
              precio_unitario: 20000,
              descuento_porcentual: 20,
            },
          ],
          medios_pago: [{ medio: "EFECTIVO", importe: 26000 }],
          tipo_comprobante: "TICKET",
        });

        assert.equal(resultado.total, 26000); // 10000 + (20000 * 0.8)
        assert.equal(resultado.comprobante_id, null);

        const items = await prisma.pedidoVentaItem.findMany({
          where: { pedido_venta_id: resultado.pedido_venta_id },
          orderBy: { created_at: "asc" },
        });
        assert.equal(items.length, 2);
        const itemResuelto = items.find((i) => i.variante_sku_id === VARIANTE_BORCEGOS_1_ID)!;
        const itemPendiente = items.find((i) => i.variante_sku_id === VARIANTE_BORCEGOS_2_ID)!;

        assert.equal(itemResuelto.requiere_autorizacion, false);
        assert.ok(itemResuelto.reserva_id);
        assert.equal(itemPendiente.requiere_autorizacion, true);
        assert.equal(itemPendiente.reserva_id, null);

        const pedidoDb = await prisma.pedidoVenta.findUniqueOrThrow({
          where: { id: resultado.pedido_venta_id },
          select: { estado: true },
        });
        assert.equal(pedidoDb.estado, "RESERVADO");
      },
    );

    // ── 8. Cleanup — cerrar el turno ad-hoc (update directo, no exercita
    //    cerrarTurnoCaja) para dejar supervisor.ventas.seed SIN turno abierto
    //    al final: mismo criterio de re-ejecutabilidad que
    //    `turno-caja.integration.test.ts`, evita que ese archivo (u otro)
    //    choque con TURNO_YA_ABIERTO si corre después de este ────────────────
    await prisma.turnoCaja.update({
      where: { id: turno.turno_caja_id },
      data: { fecha_cierre: new Date(), saldo_esperado: 0, conteo_fisico_declarado: 0, diferencia: 0 },
    });

    // ── 9. Integridad de la cadena SHA-256 del ledger completo ──────────────
    await t.test("verificarCadenaIntegridad confirma que el ledger completo (incluyendo los eventos de HU-B1) sigue íntegro", async () => {
      const resultado = await verificarCadenaIntegridad();
      assert.equal(resultado.integra, true, JSON.stringify(resultado));
    });
  },
);
