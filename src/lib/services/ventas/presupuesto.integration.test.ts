import assert from "node:assert/strict";
import test from "node:test";

/**
 * Test de integración de HU-B3 contra una base real (mismo patrón que
 * `recepcion.integration.test.ts` de HU-H4: `skip` si no hay
 * `HU_B3_INTEGRATION_DATABASE_URL`, imports dinámicos porque
 * `presupuesto.service.ts` usa `import "server-only"`).
 *
 * Cubre el hallazgo de relevamiento (task_HU-B3_cotizacion_presupuesto.md,
 * Paso 1, punto 1.3): usa los tres fixtures ya sembrados
 * (`presupuestoLicitacion`, `pedidoVentaLicitacion`,
 * `pedidoVentaRemitoParcial`) como base de verificación de solo lectura, y
 * además ejercita el flujo completo `crearPresupuesto()` →
 * `aceptarPresupuesto()` de punta a punta contra Módulo A real (congela
 * stock, decrementa `StockDeposito`, reutiliza la Reserva al aceptar).
 *
 * Corre con: `npm run test:integration:b3` (opt-in, requiere una base
 * accesible con el seed ya aplicado).
 */

const DATABASE_URL = process.env.HU_B3_INTEGRATION_DATABASE_URL;

// IDs fijos del seed (prisma/seed.ts) — mismos que documenta el informe de
// relevamiento de esta tarea.
const PRESUPUESTO_LICITACION_ID = "1a2b3c4d-be06-4a1a-8a1a-000000000001";
const PEDIDO_VENTA_LICITACION_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000002";
const RESERVA_PRESUPUESTO_LICITACION_ID = "1a2b3c4d-be08-4a1a-8a1a-000000000001";
const PEDIDO_VENTA_REMITO_PARCIAL_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000003";
const CLIENTE_MARIA_GOMEZ_PRIMARIO_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000003";
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const DEPOSITO_SEED_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
// Camisa Táctica 2 (L, Negro, HOMBRE, Manga Corta) — variante sin relación con
// los fixtures ya sembrados de HU-B3, para no interferir con su stock.
const VARIANTE_CAMISA_TACTICA_2_ID = "6fbb4612-9e6d-4661-b250-0bc62579089e";

test(
  "HU-B3 integra fixtures de seed + flujo completo crearPresupuesto/aceptarPresupuesto contra Módulo A real",
  { skip: !DATABASE_URL, timeout: 30_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, presupuestos, { ServiceError }, { iniciarAuditLogListener }, { domainEventBus }] =
      await Promise.all([
        import("../../db/prisma.ts"),
        import("./presupuesto.service.ts"),
        import("../../errors/service-error.ts"),
        import("../../events/listeners/audit-log.listener.ts"),
        import("../../events/domain-event-bus.ts"),
      ]);
    t.after(async () => prisma.$disconnect());
    iniciarAuditLogListener();

    // ── 1. Fixtures ya sembrados (solo lectura) ────────────────────────────
    await t.test("presupuestoLicitacion: EMITIDO, con su PedidoVenta RESERVADO vinculado", async () => {
      const detalle = await presupuestos.obtenerPresupuesto(PRESUPUESTO_LICITACION_ID);
      assert.ok(detalle);
      assert.equal(detalle.estado, "EMITIDO");
      assert.equal(detalle.cliente_id, CLIENTE_MARIA_GOMEZ_PRIMARIO_ID);
      assert.ok(detalle.pedido_venta);
      assert.equal(detalle.pedido_venta?.id, PEDIDO_VENTA_LICITACION_ID);
      assert.equal(detalle.pedido_venta?.estado, "RESERVADO");
      assert.equal(detalle.items.length, 1);
    });

    await t.test("pedidoVentaLicitacion reutiliza la MISMA Reserva que su PresupuestoItem origen", async () => {
      const [itemPresupuesto, itemPedido] = await Promise.all([
        prisma.presupuestoItem.findFirst({
          where: { presupuesto_id: PRESUPUESTO_LICITACION_ID },
          select: { reserva_id: true },
        }),
        prisma.pedidoVentaItem.findFirst({
          where: { pedido_venta_id: PEDIDO_VENTA_LICITACION_ID },
          select: { reserva_id: true },
        }),
      ]);
      assert.equal(itemPresupuesto?.reserva_id, RESERVA_PRESUPUESTO_LICITACION_ID);
      assert.equal(itemPedido?.reserva_id, RESERVA_PRESUPUESTO_LICITACION_ID);
    });

    await t.test("pedidoVentaRemitoParcial: REMITO_EMITIDO con saldo pendiente de entrega", async () => {
      const pedido = await prisma.pedidoVenta.findUnique({
        where: { id: PEDIDO_VENTA_REMITO_PARCIAL_ID },
        select: {
          estado: true,
          items: { orderBy: { created_at: "asc" }, select: { cantidad: true, cantidad_facturada: true, cantidad_entregada: true } },
        },
      });
      assert.equal(pedido?.estado, "REMITO_EMITIDO");
      assert.equal(pedido?.items[0]?.cantidad, 10);
      assert.equal(pedido?.items[0]?.cantidad_facturada, 10);
      assert.equal(pedido?.items[0]?.cantidad_entregada, 6);
      assert.ok((pedido?.items[0]?.cantidad_entregada ?? 0) < (pedido?.items[0]?.cantidad_facturada ?? 0));
    });

    // ── 2. CLIENTE_NO_ENCONTRADO ────────────────────────────────────────────
    await t.test("crearPresupuesto rechaza un cliente_id inexistente sin tocar stock", async () => {
      await assert.rejects(
        () =>
          presupuestos.crearPresupuesto(
            {
              cliente_id: "00000000-0000-4000-8000-000000000000",
              vigencia_dias: 5,
              origen_reserva: "LICITACION",
              items: [
                {
                  variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
                  deposito_id: DEPOSITO_SEED_ID,
                  cantidad: 1,
                  precio_cotizado: 100,
                },
              ],
            },
            USUARIO_CAJERO_SEED_ID,
          ),
        (err: unknown) => err instanceof ServiceError && err.code === "CLIENTE_NO_ENCONTRADO",
      );
    });

    // ── 3. STOCK_INSUFICIENTE (propagado desde Módulo A, sin reimplementar) ─
    await t.test("crearPresupuesto propaga STOCK_INSUFICIENTE de crearReserva() de Módulo A", async () => {
      await assert.rejects(
        () =>
          presupuestos.crearPresupuesto(
            {
              cliente_id: CLIENTE_MARIA_GOMEZ_PRIMARIO_ID,
              vigencia_dias: 5,
              origen_reserva: "LICITACION",
              items: [
                {
                  variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
                  deposito_id: DEPOSITO_SEED_ID,
                  cantidad: 999_999,
                  precio_cotizado: 100,
                },
              ],
            },
            USUARIO_CAJERO_SEED_ID,
          ),
        (err: unknown) => err instanceof ServiceError && err.code === "STOCK_INSUFICIENTE",
      );
    });

    // ── 4. Flujo feliz completo: crear → aceptar (reutiliza la Reserva) ─────
    let presupuestoNuevoId = "";
    let reservaNuevaId: string | null = null;
    let pedidoNuevoId = "";

    await t.test("crearPresupuesto congela stock real vía Módulo A y emite venta:presupuesto_emitido", async () => {
      const stockAntes = await prisma.stockDeposito.findFirstOrThrow({
        where: { variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, deposito_id: DEPOSITO_SEED_ID },
        select: { cantidad: true },
      });

      let eventoEmitido: { presupuesto_id: string; reserva_ids: string[] } | null = null;
      domainEventBus.once("venta:presupuesto_emitido", (payload) => {
        eventoEmitido = payload;
      });

      const resultado = await presupuestos.crearPresupuesto(
        {
          cliente_id: CLIENTE_MARIA_GOMEZ_PRIMARIO_ID,
          vigencia_dias: 5,
          condiciones_comerciales: "Test de integración HU-B3",
          origen_reserva: "LICITACION",
          items: [
            {
              variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID,
              deposito_id: DEPOSITO_SEED_ID,
              cantidad: 2,
              precio_cotizado: 16400,
            },
          ],
        },
        USUARIO_CAJERO_SEED_ID,
      );

      presupuestoNuevoId = resultado.presupuesto_id;
      assert.equal(resultado.estado, "EMITIDO");
      assert.equal(resultado.reservas_generadas, 1);

      const stockDespues = await prisma.stockDeposito.findFirstOrThrow({
        where: { variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, deposito_id: DEPOSITO_SEED_ID },
        select: { cantidad: true },
      });
      assert.equal(stockDespues.cantidad, stockAntes.cantidad - 2);

      const item = await prisma.presupuestoItem.findFirstOrThrow({
        where: { presupuesto_id: presupuestoNuevoId },
        select: { reserva_id: true },
      });
      reservaNuevaId = item.reserva_id;
      assert.ok(reservaNuevaId);

      assert.ok(eventoEmitido);
      assert.equal((eventoEmitido as unknown as { presupuesto_id: string }).presupuesto_id, presupuestoNuevoId);
    });

    await t.test("aceptarPresupuesto genera un PedidoVenta RESERVADO reutilizando la MISMA Reserva (sin re-congelar)", async () => {
      const stockAntesDeAceptar = await prisma.stockDeposito.findFirstOrThrow({
        where: { variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, deposito_id: DEPOSITO_SEED_ID },
        select: { cantidad: true },
      });

      const resultado = await presupuestos.aceptarPresupuesto(presupuestoNuevoId, USUARIO_CAJERO_SEED_ID);
      pedidoNuevoId = resultado.pedido_venta_id;
      assert.equal(resultado.estado, "RESERVADO");
      assert.equal(resultado.presupuesto_id, presupuestoNuevoId);

      const stockDespuesDeAceptar = await prisma.stockDeposito.findFirstOrThrow({
        where: { variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, deposito_id: DEPOSITO_SEED_ID },
        select: { cantidad: true },
      });
      // Aceptar NO vuelve a tocar stock — reutiliza la reserva ya congelada.
      assert.equal(stockDespuesDeAceptar.cantidad, stockAntesDeAceptar.cantidad);

      const itemPedido = await prisma.pedidoVentaItem.findFirstOrThrow({
        where: { pedido_venta_id: pedidoNuevoId },
        select: { reserva_id: true, cantidad: true, precio_unitario: true },
      });
      assert.equal(itemPedido.reserva_id, reservaNuevaId);
      assert.equal(itemPedido.cantidad, 2);

      // El Presupuesto origen queda vinculado y su estado permanece EMITIDO
      // (el enum EstadoPresupuesto no tiene un valor "ACEPTADO"/"CONVERTIDO").
      const presupuestoTrasAceptar = await presupuestos.obtenerPresupuesto(presupuestoNuevoId);
      assert.equal(presupuestoTrasAceptar?.estado, "EMITIDO");
      assert.equal(presupuestoTrasAceptar?.pedido_venta?.id, pedidoNuevoId);
    });

    // ── 5. PRESUPUESTO_YA_CONVERTIDO (doble aceptación) ─────────────────────
    await t.test("aceptarPresupuesto rechaza una segunda aceptación del mismo presupuesto (nuevo y el ya sembrado)", async () => {
      await assert.rejects(
        () => presupuestos.aceptarPresupuesto(presupuestoNuevoId, USUARIO_CAJERO_SEED_ID),
        (err: unknown) => err instanceof ServiceError && err.code === "PRESUPUESTO_YA_CONVERTIDO",
      );
      await assert.rejects(
        () => presupuestos.aceptarPresupuesto(PRESUPUESTO_LICITACION_ID, USUARIO_CAJERO_SEED_ID),
        (err: unknown) => err instanceof ServiceError && err.code === "PRESUPUESTO_YA_CONVERTIDO",
      );
    });

    // ── 6. TRANSICION_INVALIDA (estado origen distinto de EMITIDO) ──────────
    await t.test("aceptarPresupuesto rechaza un Presupuesto BORRADOR con TRANSICION_INVALIDA", async () => {
      // BORRADOR no es alcanzable vía el contrato público de crearPresupuesto()
      // (emite directo en EMITIDO) — se inserta manualmente solo para probar
      // esta rama de la máquina de estados.
      const borrador = await prisma.presupuesto.create({
        data: {
          cliente_id: CLIENTE_MARIA_GOMEZ_PRIMARIO_ID,
          estado: "BORRADOR",
          vigencia_dias: 5,
          creado_por_id: USUARIO_CAJERO_SEED_ID,
        },
        select: { id: true },
      });

      await assert.rejects(
        () => presupuestos.aceptarPresupuesto(borrador.id, USUARIO_CAJERO_SEED_ID),
        (err: unknown) => err instanceof ServiceError && err.code === "TRANSICION_INVALIDA",
      );
    });
  },
);
