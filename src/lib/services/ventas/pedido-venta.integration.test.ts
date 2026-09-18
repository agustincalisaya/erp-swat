import assert from "node:assert/strict";
import test from "node:test";

/**
 * Test de integración de HU-B4 contra una base real (mismo patrón que
 * `presupuesto.integration.test.ts` de HU-B3: `skip` si no hay
 * `HU_B4_INTEGRATION_DATABASE_URL`, imports dinámicos porque
 * `pedido-venta.service.ts` usa `import "server-only"`).
 *
 * Usa el fixture ya sembrado `V-2026-000003`
 * (`PEDIDO_VENTA_REMITO_PARCIAL_ID`, ítem sobre `VARIANTE_BORCEGOS_2_ID`,
 * `requiere_autorizacion: true`) SOLO para los casos de solo-lectura y de
 * rechazo (que nunca llegan a mutar el ítem, por el orden de validaciones
 * del servicio). El flujo feliz de autorización crea su PROPIO
 * PedidoVenta/PedidoVentaItem ad-hoc — igual que
 * `presupuesto.integration.test.ts` crea su propio Presupuesto BORRADOR —
 * para no consumir el fixture de referencia y mantener el test re-ejecutable.
 *
 * Corre con: `npm run test:integration:b4` (opt-in, requiere una base
 * accesible con el seed ya aplicado).
 */

const DATABASE_URL = process.env.HU_B4_INTEGRATION_DATABASE_URL;

// IDs fijos del seed (prisma/seed.ts).
const PEDIDO_VENTA_REMITO_PARCIAL_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000003";
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";

test(
  "HU-B4 integra el fixture de seed + flujo completo autorizarOverrideDescuento contra una base real",
  { skip: !DATABASE_URL, timeout: 30_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, pedidoVenta, { ServiceError }, { iniciarAuditLogListener }, { domainEventBus }] =
      await Promise.all([
        import("../../db/prisma.ts"),
        import("./pedido-venta.service.ts"),
        import("../../errors/service-error.ts"),
        import("../../events/listeners/audit-log.listener.ts"),
        import("../../events/domain-event-bus.ts"),
      ]);
    t.after(async () => prisma.$disconnect());
    iniciarAuditLogListener();

    // El listener de auditoría es fire-and-forget (regla no-negociable del
    // proyecto, ver `audit-log.listener.ts`) — mismo patrón de espera ya
    // usado en `cliente.integration.test.ts` para esperar su materialización
    // antes de aserir contra la fila real de `AuditLog`.
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

    // ── 1. Fixture ya sembrado (solo lectura) ──────────────────────────────
    await t.test("V-2026-000003: ítem sobre VARIANTE_BORCEGOS_2_ID pendiente de autorización", async () => {
      const item = await prisma.pedidoVentaItem.findFirst({
        where: { pedido_venta_id: PEDIDO_VENTA_REMITO_PARCIAL_ID, variante_sku_id: VARIANTE_BORCEGOS_2_ID },
        select: { requiere_autorizacion: true, autorizado_por_id: true },
      });
      assert.equal(item?.requiere_autorizacion, true);
      assert.equal(item?.autorizado_por_id, null);
    });

    // ── 2. PEDIDO_VENTA_NO_ENCONTRADO ───────────────────────────────────────
    await t.test("rechaza un pedido_venta_id inexistente", async () => {
      await assert.rejects(
        () =>
          pedidoVenta.autorizarOverrideDescuento(
            "00000000-0000-4000-8000-000000000000",
            {
              variante_sku_id: VARIANTE_BORCEGOS_2_ID,
              descuento_porcentual_solicitado: 10,
              motivo: "test",
              supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
            },
            USUARIO_CAJERO_SEED_ID,
            "integration-test",
          ),
        (err: unknown) => err instanceof ServiceError && err.code === "PEDIDO_VENTA_NO_ENCONTRADO",
      );
    });

    // ── 3. TRANSICION_INVALIDA — variante_sku_id sin match ──────────────────
    await t.test("rechaza un variante_sku_id que no matchea ningún ítem pendiente del pedido", async () => {
      await assert.rejects(
        () =>
          pedidoVenta.autorizarOverrideDescuento(
            PEDIDO_VENTA_REMITO_PARCIAL_ID,
            {
              variante_sku_id: "00000000-0000-4000-8000-000000000000",
              descuento_porcentual_solicitado: 10,
              motivo: "test",
              supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
            },
            USUARIO_CAJERO_SEED_ID,
            "integration-test",
          ),
        (err: unknown) => err instanceof ServiceError && err.code === "TRANSICION_INVALIDA",
      );
    });

    // ── 4. SIN_PERMISO_AUTORIZACION — cajero.seed no tiene el permiso ───────
    await t.test("rechaza cuando supervisor_credencial.usuario_id no tiene ventas:autorizar_excepcion_descuento", async () => {
      await assert.rejects(
        () =>
          pedidoVenta.autorizarOverrideDescuento(
            PEDIDO_VENTA_REMITO_PARCIAL_ID,
            {
              variante_sku_id: VARIANTE_BORCEGOS_2_ID,
              descuento_porcentual_solicitado: 10,
              motivo: "test",
              supervisor_credencial: { usuario_id: USUARIO_CAJERO_SEED_ID },
            },
            USUARIO_CAJERO_SEED_ID,
            "integration-test",
          ),
        (err: unknown) => err instanceof ServiceError && err.code === "SIN_PERMISO_AUTORIZACION",
      );

      // El rechazo ocurre ANTES de cualquier UPDATE — el fixture queda intacto
      // para el resto de la suite (y para futuras corridas).
      const item = await prisma.pedidoVentaItem.findFirst({
        where: { pedido_venta_id: PEDIDO_VENTA_REMITO_PARCIAL_ID, variante_sku_id: VARIANTE_BORCEGOS_2_ID },
        select: { requiere_autorizacion: true, autorizado_por_id: true },
      });
      assert.equal(item?.requiere_autorizacion, true);
      assert.equal(item?.autorizado_por_id, null);
    });

    // ── 5. Flujo feliz completo — PedidoVenta/PedidoVentaItem ad-hoc ────────
    let pedidoAdHocId = "";

    await t.test("crea un PedidoVenta/PedidoVentaItem ad-hoc pendiente de autorización (fixture propio, no toca el seed)", async () => {
      const pedido = await prisma.pedidoVenta.create({
        data: {
          numero_venta: `V-TEST-B4-${Date.now()}`,
          registrado_por_id: USUARIO_CAJERO_SEED_ID,
          estado: "RESERVADO",
          total: 41500,
          items: {
            create: {
              variante_sku_id: VARIANTE_BORCEGOS_2_ID,
              cantidad: 1,
              precio_unitario: 41500,
              requiere_autorizacion: true,
            },
          },
        },
        select: { id: true },
      });
      pedidoAdHocId = pedido.id;
    });

    await t.test("autorizarOverrideDescuento aplica el descuento, autoriza el ítem y emite venta:descuento_fuera_margen", async () => {
      let eventoEmitido: {
        autorizacion_id: string;
        pedido_venta_id: string;
        usuario_solicitante_id: string;
        usuario_autorizante_id: string;
        porcentaje_aplicado: number;
      } | null = null;
      domainEventBus.once("venta:descuento_fuera_margen", (payload) => {
        eventoEmitido = payload;
      });

      const resultado = await pedidoVenta.autorizarOverrideDescuento(
        pedidoAdHocId,
        {
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          descuento_porcentual_solicitado: 12.5,
          motivo: "Cliente institucional — negociación puntual autorizada por Supervisor",
          supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
        },
        USUARIO_CAJERO_SEED_ID,
        "integration-test",
      );

      assert.equal(resultado.descuento_aplicado, 12.5);
      assert.equal(resultado.autorizado_por, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
      assert.match(resultado.autorizacion_id, /^[0-9a-f-]{36}$/);

      const item = await prisma.pedidoVentaItem.findFirstOrThrow({
        where: { pedido_venta_id: pedidoAdHocId },
        select: { requiere_autorizacion: true, autorizado_por_id: true, descuento_porcentual: true },
      });
      assert.equal(item.requiere_autorizacion, false);
      assert.equal(item.autorizado_por_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
      assert.equal(item.descuento_porcentual?.toNumber(), 12.5);

      assert.ok(eventoEmitido);
      const evento = eventoEmitido as unknown as {
        autorizacion_id: string;
        pedido_venta_id: string;
        usuario_solicitante_id: string;
        usuario_autorizante_id: string;
        porcentaje_aplicado: number;
      };
      assert.equal(evento.pedido_venta_id, pedidoAdHocId);
      assert.equal(evento.usuario_solicitante_id, USUARIO_CAJERO_SEED_ID);
      assert.equal(evento.usuario_autorizante_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
      assert.equal(evento.porcentaje_aplicado, 12.5);
      assert.equal(evento.autorizacion_id, resultado.autorizacion_id);

      // AuditLog real, escrito de forma asíncrona por el listener —
      // `autorizacion_id` debe quedar buscable dentro de `valor_nuevo`.
      const filasAudit = await esperarAuditLog(pedidoAdHocId, "DESCUENTO_FUERA_MARGEN");
      assert.equal(filasAudit.length, 1);
      const valorNuevo = filasAudit[0]!.valor_nuevo as { autorizacion_id?: string } | null;
      assert.equal(valorNuevo?.autorizacion_id, resultado.autorizacion_id);
    });

    // ── 6. TRANSICION_INVALIDA — doble autorización del mismo ítem ──────────
    await t.test("rechaza una segunda autorización sobre el mismo ítem ya autorizado", async () => {
      await assert.rejects(
        () =>
          pedidoVenta.autorizarOverrideDescuento(
            pedidoAdHocId,
            {
              variante_sku_id: VARIANTE_BORCEGOS_2_ID,
              descuento_porcentual_solicitado: 5,
              motivo: "segundo intento",
              supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
            },
            USUARIO_CAJERO_SEED_ID,
            "integration-test",
          ),
        (err: unknown) => err instanceof ServiceError && err.code === "TRANSICION_INVALIDA",
      );
    });

    // ── 7. autorizarOverrideDescuento — cambio manual de precio ─────────────
    await t.test("autoriza un cambio manual de precio (precio_lista_modificado → precio_unitario) y emite venta:cambio_precio_manual", async () => {
      const pedidoPrecio = await prisma.pedidoVenta.create({
        data: {
          numero_venta: `V-TEST-B4-PRECIO-${Date.now()}`,
          registrado_por_id: USUARIO_CAJERO_SEED_ID,
          estado: "RESERVADO",
          total: 41500,
          items: {
            create: {
              variante_sku_id: VARIANTE_BORCEGOS_2_ID,
              cantidad: 1,
              precio_unitario: 41500,
              requiere_autorizacion: true,
            },
          },
        },
        select: { id: true },
      });

      let eventoEmitido: { precio_anterior: number; precio_nuevo: number } | null = null;
      domainEventBus.once("venta:cambio_precio_manual", (payload) => {
        eventoEmitido = payload;
      });

      const resultado = await pedidoVenta.autorizarOverrideDescuento(
        pedidoPrecio.id,
        {
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          precio_lista_modificado: 38000,
          motivo: "Ajuste manual de precio autorizado por Supervisor",
          supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
        },
        USUARIO_CAJERO_SEED_ID,
        "integration-test",
      );

      assert.equal(resultado.descuento_aplicado, null);

      const item = await prisma.pedidoVentaItem.findFirstOrThrow({
        where: { pedido_venta_id: pedidoPrecio.id },
        select: { precio_unitario: true, requiere_autorizacion: true },
      });
      assert.equal(item.precio_unitario.toNumber(), 38000);
      assert.equal(item.requiere_autorizacion, false);

      assert.ok(eventoEmitido);
      const evento = eventoEmitido as unknown as { precio_anterior: number; precio_nuevo: number };
      assert.equal(evento.precio_anterior, 41500);
      assert.equal(evento.precio_nuevo, 38000);

      const filasAudit = await esperarAuditLog(pedidoPrecio.id, "CAMBIO_PRECIO_MANUAL");
      assert.equal(filasAudit.length, 1);
      const valorNuevo = filasAudit[0]!.valor_nuevo as { autorizacion_id?: string } | null;
      assert.equal(valorNuevo?.autorizacion_id, resultado.autorizacion_id);
    });
  },
);
