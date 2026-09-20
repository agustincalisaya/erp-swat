import assert from "node:assert/strict";
import test from "node:test";

/**
 * Nivel 3 de HU-B6 — `obtenerLogsVentas()` contra una base real (opt-in:
 * `HU_B6_INTEGRATION_DATABASE_URL`, mismo patrón que B4/B5; imports
 * dinámicos porque el servicio usa `import "server-only"`).
 *
 * Genera SUS PROPIOS eventos vía los servicios reales de HU-B4/HU-B5 (con el
 * listener de auditoría activo), sin depender de que otras suites hayan
 * corrido antes, sobre tres pedidos ad-hoc:
 *
 *  - REGULAR  (solicitante cajero.seed, autorizante supervisor.ventas.seed):
 *    DESCUENTO + CAMBIO_PRECIO + EXCEPCION_CREDITO_RECHAZADA.
 *  - ESCALADO (solicitante supervisor.ventas.seed, autorizante Master):
 *    DESCUENTO + CAMBIO_PRECIO + EXCEPCION_CREDITO_RECHAZADA. Es el caso que
 *    valida el OR por path JSON (decisiones 4/10): el supervisor solo
 *    aparece como `valor_nuevo.usuario_solicitante_id`, nunca como
 *    `AuditLog.usuario_id`. CAMBIO_PRECIO no lleva solicitante en su payload,
 *    así que el supervisor NO debe verlo.
 *  - AJENO    (solicitante cajero.seed, autorizante Master): fuera del alcance
 *    del supervisor — control negativo.
 *
 * "Master" = usuario con rol `MASTER` en la base (no existe en el seed; los
 * subtests que lo necesitan se saltean si no hay ninguno). Los eventos son
 * append-only: quedan en `audit_logs`; los pedidos/operaciones ad-hoc se dan
 * de baja lógica al terminar (nunca DELETE).
 *
 * Corre con: `npm run test:integration:b6`.
 */

const DATABASE_URL = process.env.HU_B6_INTEGRATION_DATABASE_URL;

const CLIENTE_JUAN_PEREZ_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000001";
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";

const ACCIONES_MODULO_B = [
  "DESCUENTO_FUERA_MARGEN",
  "CAMBIO_PRECIO_MANUAL",
  "EXCEPCION_CREDITO_APROBADA",
  "EXCEPCION_CREDITO_RECHAZADA",
];

test(
  "HU-B6 — obtenerLogsVentas contra una base real (alcance Auditor/Supervisor, caso escalado, filtros, integridad)",
  { skip: !DATABASE_URL, timeout: 180_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [{ prisma }, ventasSvc, pedidoVenta, cc, { ServiceError }, { iniciarAuditLogListener }] =
      await Promise.all([
        import("../../db/prisma.ts"),
        import("./auditoria-ventas.service.ts"),
        import("./pedido-venta.service.ts"),
        import("./cuenta-corriente.service.ts"),
        import("../../errors/service-error.ts"),
        import("../../events/listeners/audit-log.listener.ts"),
      ]);
    iniciarAuditLogListener();

    const pedidosAdHoc: string[] = [];
    const operacionesAdHoc: string[] = [];

    t.after(async () => {
      if (operacionesAdHoc.length > 0) {
        await prisma.cuentaCorrienteOperacion.updateMany({
          where: { id: { in: operacionesAdHoc } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B6" },
        });
      }
      if (pedidosAdHoc.length > 0) {
        await prisma.pedidoVenta.updateMany({
          where: { id: { in: pedidosAdHoc } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B6" },
        });
      }
      await prisma.$disconnect();
    });

    // ── Usuarios ────────────────────────────────────────────────────────────
    const auditor = await prisma.usuario.findFirstOrThrow({
      where: { nombre_usuario: "auditor.seed" },
      select: { id: true, nombre_usuario: true },
    });
    const masterRow = await prisma.usuarioRol.findFirst({
      where: { is_active: true, rol: { nombre: "MASTER", is_active: true }, usuario: { estado: "ACTIVO", is_active: true } },
      select: { usuario: { select: { id: true, nombre_usuario: true } } },
    });
    const master = masterRow?.usuario ?? null;

    const sesion = (u: { id: string; nombre_usuario: string }) => ({ userId: u.id, nombreUsuario: u.nombre_usuario });
    const sesionAuditor = sesion(auditor);
    const sesionSupervisor = sesion({ id: USUARIO_SUPERVISOR_VENTAS_SEED_ID, nombre_usuario: "supervisor.ventas.seed" });
    const sesionCajero = sesion({ id: USUARIO_CAJERO_SEED_ID, nombre_usuario: "cajero.seed" });
    const sesionMaster = master ? sesion(master) : null;

    const base = { verificar_integridad: false, page: 1, page_size: 50 } as const;

    // ── Helpers de fixtures ─────────────────────────────────────────────────
    // El listener es fire-and-forget y `registrarAuditLog()` encadena contra
    // el último hash: se espera cada fila ANTES de emitir el siguiente evento
    // para no bifurcar la cadena.
    async function esperarAuditLog(registroId: string, accion: string) {
      for (let intento = 0; intento < 60; intento++) {
        const fila = await prisma.auditLog.findFirst({ where: { registro_id: registroId, accion } });
        if (fila) return fila;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`AuditLog ${accion}/${registroId} no apareció a tiempo`);
    }

    async function crearPedido(solicitanteId: string, etiqueta: string) {
      const pedido = await prisma.pedidoVenta.create({
        data: {
          numero_venta: `V-TEST-B6-${etiqueta}-${Date.now()}`,
          cliente_id: CLIENTE_JUAN_PEREZ_ID,
          registrado_por_id: solicitanteId,
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
      pedidosAdHoc.push(pedido.id);
      return pedido.id;
    }

    /** Descuento + cambio de precio (2 eventos) sobre el pedido. */
    async function autorizarDescuentoYPrecio(pedidoId: string, solicitanteId: string, autorizanteId: string) {
      await pedidoVenta.autorizarOverrideDescuento(
        pedidoId,
        {
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          descuento_porcentual_solicitado: 10,
          precio_lista_modificado: 45000,
          motivo: "fixture HU-B6",
          supervisor_credencial: { usuario_id: autorizanteId },
        },
        solicitanteId,
        "integration-test",
      );
      await esperarAuditLog(pedidoId, "DESCUENTO_FUERA_MARGEN");
      await esperarAuditLog(pedidoId, "CAMBIO_PRECIO_MANUAL");
    }

    /** Operación RETENIDA (monto sobre el límite, saldo intacto) resuelta con RECHAZAR (saldo intacto). */
    async function retenerYRechazar(pedidoId: string, autorizanteId: string) {
      let operacionId = "";
      await assert.rejects(
        () => cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, { pedido_venta_id: pedidoId, monto: 999_999 }),
        (err: unknown) => {
          assert.ok(err instanceof ServiceError);
          assert.equal(err.code, "LIMITE_CREDITO_EXCEDIDO");
          operacionId = (err.details as { operacion_id: string }).operacion_id;
          return true;
        },
      );
      operacionesAdHoc.push(operacionId);
      await cc.resolverExcepcionCredito(operacionId, { decision: "RECHAZAR", motivo: "fixture HU-B6" }, autorizanteId);
      await esperarAuditLog(operacionId, "EXCEPCION_CREDITO_RECHAZADA");
      return operacionId;
    }

    // ── Generación de eventos ───────────────────────────────────────────────
    let pedidoRegular = "";
    let operacionRegular = "";
    let pedidoEscalado = "";
    let operacionEscalada = "";
    let pedidoAjeno = "";
    let operacionAjena = "";

    await t.test("genera los eventos de fixture: REGULAR (cajero → supervisor)", async () => {
      pedidoRegular = await crearPedido(USUARIO_CAJERO_SEED_ID, "REG");
      await autorizarDescuentoYPrecio(pedidoRegular, USUARIO_CAJERO_SEED_ID, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
      operacionRegular = await retenerYRechazar(pedidoRegular, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
    });

    await t.test("genera los eventos de fixture: ESCALADO (supervisor → Master) y AJENO (cajero → Master)", { skip: !master }, async () => {
      pedidoEscalado = await crearPedido(USUARIO_SUPERVISOR_VENTAS_SEED_ID, "ESC");
      await autorizarDescuentoYPrecio(pedidoEscalado, USUARIO_SUPERVISOR_VENTAS_SEED_ID, master!.id);
      operacionEscalada = await retenerYRechazar(pedidoEscalado, master!.id);

      pedidoAjeno = await crearPedido(USUARIO_CAJERO_SEED_ID, "AJE");
      await autorizarDescuentoYPrecio(pedidoAjeno, USUARIO_CAJERO_SEED_ID, master!.id);
      operacionAjena = await retenerYRechazar(pedidoAjeno, master!.id);
    });

    // ── Gate ────────────────────────────────────────────────────────────────
    await t.test("cajero.seed (sin ninguno de los dos permisos) → FORBIDDEN, y el nivel resuelto es null", async () => {
      assert.equal(await ventasSvc.resolverNivelAccesoAuditoriaVentas(USUARIO_CAJERO_SEED_ID), null);
      await assert.rejects(
        () => ventasSvc.obtenerLogsVentas({ ...base }, sesionCajero),
        (err: unknown) => err instanceof ServiceError && err.code === "FORBIDDEN",
      );
    });

    await t.test("niveles: auditor.seed → AUDITOR, supervisor.ventas.seed → SUPERVISOR, MASTER (leer_forense + leer_log_operativo) → AUDITOR", async () => {
      assert.equal(await ventasSvc.resolverNivelAccesoAuditoriaVentas(auditor.id), "AUDITOR");
      assert.equal(await ventasSvc.resolverNivelAccesoAuditoriaVentas(USUARIO_SUPERVISOR_VENTAS_SEED_ID), "SUPERVISOR");
      if (master) assert.equal(await ventasSvc.resolverNivelAccesoAuditoriaVentas(master.id), "AUDITOR");
    });

    // ── Auditor: dominio, filtros, shape ────────────────────────────────────
    await t.test("Auditor: solo acciones de Módulo B (nunca LOGIN/CREATE/etc.), shape con page/page_size", async () => {
      const r = await ventasSvc.obtenerLogsVentas({ ...base }, sesionAuditor);
      assert.ok(r.total >= 3);
      assert.equal(r.page, 1);
      assert.equal(r.page_size, 50);
      assert.equal(r.verificacion_integridad, undefined);
      for (const reg of r.registros) assert.ok(ACCIONES_MODULO_B.includes(reg.accion), reg.accion);
    });

    await t.test("Auditor: tipo_evento filtra la acción correcta (incluye APROBADA+RECHAZADA en excepción de crédito)", async () => {
      const desc = await ventasSvc.obtenerLogsVentas({ ...base, tipo_evento: "venta:descuento_fuera_margen" }, sesionAuditor);
      assert.ok(desc.total >= 1);
      assert.ok(desc.registros.every((x) => x.accion === "DESCUENTO_FUERA_MARGEN"));

      const precio = await ventasSvc.obtenerLogsVentas({ ...base, tipo_evento: "venta:cambio_precio_manual" }, sesionAuditor);
      assert.ok(precio.total >= 1);
      assert.ok(precio.registros.every((x) => x.accion === "CAMBIO_PRECIO_MANUAL"));

      const cred = await ventasSvc.obtenerLogsVentas({ ...base, tipo_evento: "venta:excepcion_credito_resuelta" }, sesionAuditor);
      assert.ok(cred.total >= 1);
      assert.ok(cred.registros.every((x) => x.accion.startsWith("EXCEPCION_CREDITO_")));

      // Placeholder de anulación: sin código todavía → 0 filas, sin error.
      const anul = await ventasSvc.obtenerLogsVentas({ ...base, tipo_evento: "venta:anulacion_pedido" }, sesionAuditor);
      assert.equal(anul.total, 0);
    });

    await t.test("Auditor: pedido_venta_id devuelve descuento/precio (por registro_id) Y la excepción de crédito (solo por path JSON)", async () => {
      const r = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoRegular }, sesionAuditor);
      assert.equal(r.total, 3);
      const porAccion = Object.fromEntries(r.registros.map((x) => [x.accion, x]));
      assert.equal(porAccion["DESCUENTO_FUERA_MARGEN"]?.registro_id, pedidoRegular);
      assert.equal(porAccion["CAMBIO_PRECIO_MANUAL"]?.registro_id, pedidoRegular);
      // El evento de crédito NO tiene el pedido como registro_id: es la operación.
      assert.equal(porAccion["EXCEPCION_CREDITO_RECHAZADA"]?.registro_id, operacionRegular);
      assert.equal(porAccion["EXCEPCION_CREDITO_RECHAZADA"]?.tabla_afectada, "cuenta_corriente_operaciones");
      assert.notEqual(porAccion["EXCEPCION_CREDITO_RECHAZADA"]?.registro_id, pedidoRegular);
    });

    await t.test("Auditor: usuario_id filtra por autorizante", async () => {
      const r = await ventasSvc.obtenerLogsVentas(
        { ...base, pedido_venta_id: pedidoRegular, usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
        sesionAuditor,
      );
      assert.equal(r.total, 3);
      assert.ok(r.registros.every((x) => x.usuario_id === USUARIO_SUPERVISOR_VENTAS_SEED_ID));
      const nadie = await ventasSvc.obtenerLogsVentas(
        { ...base, pedido_venta_id: pedidoRegular, usuario_id: USUARIO_CAJERO_SEED_ID },
        sesionAuditor,
      );
      assert.equal(nadie.total, 0);
    });

    await t.test("fecha_hasta = hoy (medianoche UTC) incluye los eventos de hoy (fin de día); fecha_desde mañana los excluye", async () => {
      const hoy = new Date(new Date().toISOString().slice(0, 10)); // 00:00:00.000 UTC de hoy
      const manana = new Date(hoy.getTime() + 24 * 60 * 60 * 1000);
      const conHasta = await ventasSvc.obtenerLogsVentas(
        { ...base, pedido_venta_id: pedidoRegular, fecha_desde: hoy, fecha_hasta: hoy },
        sesionAuditor,
      );
      assert.equal(conHasta.total, 3);
      const futuro = await ventasSvc.obtenerLogsVentas(
        { ...base, pedido_venta_id: pedidoRegular, fecha_desde: manana },
        sesionAuditor,
      );
      assert.equal(futuro.total, 0);
    });

    // ── Supervisor: alcance ─────────────────────────────────────────────────
    await t.test("Supervisor: ve los eventos que autorizó (REGULAR: usuario_id = supervisor) con valor_anterior/valor_nuevo", async () => {
      const r = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoRegular }, sesionSupervisor);
      assert.equal(r.total, 3);
      assert.ok(r.registros.every((x) => x.usuario_id === USUARIO_SUPERVISOR_VENTAS_SEED_ID));
      // Decisión 8: el detalle también es visible para el Supervisor.
      for (const reg of r.registros) assert.notEqual(reg.valor_nuevo, null, reg.accion);
      const precio = r.registros.find((x) => x.accion === "CAMBIO_PRECIO_MANUAL");
      assert.deepEqual(precio?.valor_anterior, { precio_unitario: 41500 });
    });

    await t.test(
      "Supervisor: caso ESCALADO — solicitante ≠ autorizante — ve DESCUENTO y EXCEPCION (por path JSON) pero NO CAMBIO_PRECIO (sin solicitante en su payload)",
      { skip: !master },
      async () => {
        const r = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoEscalado }, sesionSupervisor);
        const acciones = r.registros.map((x) => x.accion).sort();
        assert.deepEqual(acciones, ["DESCUENTO_FUERA_MARGEN", "EXCEPCION_CREDITO_RECHAZADA"]);
        assert.equal(r.total, 2);
        for (const reg of r.registros) {
          // El supervisor NO es el autorizante de estos eventos…
          assert.equal(reg.usuario_id, master!.id);
          // …aparece solo como solicitante dentro del JSON.
          const vn = reg.valor_nuevo as { usuario_solicitante_id?: string };
          assert.equal(vn.usuario_solicitante_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
        }
        assert.ok(r.registros.some((x) => x.registro_id === operacionEscalada));

        // El Auditor ve los 3 del mismo pedido.
        const a = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoEscalado }, sesionAuditor);
        assert.equal(a.total, 3);
      },
    );

    await t.test("Supervisor: NO ve eventos AJENOS (ni autorizante ni solicitante)", { skip: !master }, async () => {
      const r = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoAjeno }, sesionSupervisor);
      assert.equal(r.total, 0);
      assert.equal(r.registros.length, 0);
      const a = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoAjeno }, sesionAuditor);
      assert.equal(a.total, 3);
      assert.ok(a.registros.some((x) => x.registro_id === operacionAjena));
    });

    await t.test("Supervisor: sin filtros, TODO lo devuelto cumple (autorizante = él OR solicitante = él)", async () => {
      const r = await ventasSvc.obtenerLogsVentas({ ...base }, sesionSupervisor);
      assert.ok(r.total >= 3);
      for (const reg of r.registros) {
        const vn = reg.valor_nuevo as { usuario_solicitante_id?: string } | null;
        assert.ok(
          reg.usuario_id === USUARIO_SUPERVISOR_VENTAS_SEED_ID ||
            vn?.usuario_solicitante_id === USUARIO_SUPERVISOR_VENTAS_SEED_ID,
          `${reg.accion}/${reg.id} fuera de alcance`,
        );
      }
      // El Auditor ve estrictamente más (o igual) que el Supervisor.
      const a = await ventasSvc.obtenerLogsVentas({ ...base }, sesionAuditor);
      assert.ok(a.total >= r.total);
    });

    await t.test("Supervisor: paginación en base — total estable, páginas disjuntas y de tamaño acotado", async () => {
      const completo = await ventasSvc.obtenerLogsVentas({ ...base }, sesionSupervisor);
      assert.ok(completo.total >= 3);
      const p1 = await ventasSvc.obtenerLogsVentas({ ...base, page: 1, page_size: 2 }, sesionSupervisor);
      const p2 = await ventasSvc.obtenerLogsVentas({ ...base, page: 2, page_size: 2 }, sesionSupervisor);
      assert.equal(p1.total, completo.total);
      assert.equal(p2.total, completo.total);
      assert.equal(p1.registros.length, 2);
      assert.ok(p2.registros.length >= 1 && p2.registros.length <= 2);
      const ids1 = new Set(p1.registros.map((x) => x.id));
      assert.ok(p2.registros.every((x) => !ids1.has(x.id)));
      // Mismo orden global (created_at desc) que la página completa.
      assert.deepEqual(
        [...p1.registros, ...p2.registros].map((x) => x.id),
        completo.registros.slice(0, p1.registros.length + p2.registros.length).map((x) => x.id),
      );
    });

    await t.test("Supervisor: usuario_id de otro no amplía su alcance (AND con el OR de alcance)", { skip: !master }, async () => {
      const r = await ventasSvc.obtenerLogsVentas(
        { ...base, pedido_venta_id: pedidoAjeno, usuario_id: master!.id },
        sesionSupervisor,
      );
      assert.equal(r.total, 0);
      // Sí ve los que Master autorizó cuando el solicitante era él (ESCALADO).
      const esc = await ventasSvc.obtenerLogsVentas(
        { ...base, pedido_venta_id: pedidoEscalado, usuario_id: master!.id },
        sesionSupervisor,
      );
      assert.equal(esc.total, 2);
    });

    // ── Integridad ──────────────────────────────────────────────────────────
    await t.test("Supervisor + verificar_integridad → VERIFICACION_INTEGRIDAD_NO_DISPONIBLE (403 de servicio)", async () => {
      await assert.rejects(
        () => ventasSvc.obtenerLogsVentas({ ...base, verificar_integridad: true }, sesionSupervisor),
        (err: unknown) => err instanceof ServiceError && err.code === "VERIFICACION_INTEGRIDAD_NO_DISPONIBLE",
      );
    });

    await t.test("Auditor + verificar_integridad → verificacion_integridad con `integra` calculado sobre la cadena completa", async () => {
      const total = await prisma.auditLog.count({ where: { accion: { in: ACCIONES_MODULO_B } } });
      const r = await ventasSvc.obtenerLogsVentas({ ...base, verificar_integridad: true }, sesionAuditor);
      assert.ok(r.verificacion_integridad);
      assert.equal(typeof r.verificacion_integridad.integra, "boolean");
      if (r.verificacion_integridad.integra) {
        // Cuenta SOLO eventos de Módulo B aunque haya recorrido toda la cadena.
        assert.equal(r.verificacion_integridad.registros_verificados, total);
      } else {
        assert.ok(r.verificacion_integridad.primer_registro_divergente_id);
        assert.ok(r.verificacion_integridad.registros_verificados <= total);
      }
    });

    await t.test("Master (leer_forense con precedencia): ve todos los usuarios y PUEDE verificar integridad", { skip: !master }, async () => {
      const r = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoAjeno, verificar_integridad: true }, sesionMaster!);
      assert.equal(r.total, 3);
      assert.ok(r.verificacion_integridad);
      const regular = await ventasSvc.obtenerLogsVentas({ ...base, pedido_venta_id: pedidoRegular }, sesionMaster!);
      assert.equal(regular.total, 3); // eventos autorizados por OTRO usuario (supervisor)
    });
  },
);
