import assert from "node:assert/strict";
import test from "node:test";

/**
 * Test de integración de HU-B2 contra una base real (mismo patrón que
 * `pedido-venta.integration.test.ts` de HU-B4: `skip` si no hay
 * `HU_B2_INTEGRATION_DATABASE_URL`, imports dinámicos porque
 * `turno-caja.service.ts` usa `import "server-only"`).
 *
 * Corre con: `npm run test:integration:b2` (opt-in, requiere una base
 * accesible con el seed ya aplicado).
 *
 * HALLAZGO DE RELEVAMIENTO (task_relos.md §6.2 punto 2 asumía que "HU-B1
 * todavía no existe en código en este punto de la secuencia", así que no
 * habría `VentaMedioPago` reales para probar la suma de `saldo_esperado`):
 * el seed YA tiene un fixture real y completo — `TURNO_CAJA_ABIERTO_ID`
 * (turno abierto de `cajero.seed`, `fondo_fijo_inicial: 5000`) con un
 * `PedidoVenta` FACTURADO (`PEDIDO_VENTA_MOSTRADOR_ID`) que tiene DOS
 * `VentaMedioPago`, uno de ellos `EFECTIVO: 20000`
 * (`VENTA_MEDIO_PAGO_EFECTIVO_ID`). Este archivo lo aprovecha para verificar
 * la agregación real contra datos genuinamente sembrados (Sección
 * "1. Fixture ya sembrado" abajo), SIN cerrar ese turno — es un fixture
 * compartido que otras HU/tests pueden asumir abierto, mismo criterio que
 * `pedido-venta.integration.test.ts` con `V-2026-000003`. El resto de la
 * suite (apertura/cierre/umbral/justificación) usa un `TurnoCaja` ad-hoc del
 * usuario `supervisor.ventas.seed` para no consumir ningún fixture
 * compartido y mantenerse re-ejecutable.
 */

const DATABASE_URL = process.env.HU_B2_INTEGRATION_DATABASE_URL;

// IDs fijos del seed (prisma/seed.ts).
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";
const TURNO_CAJA_ABIERTO_ID = "1a2b3c4d-be01-4a1a-8a1a-000000000001";
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

test(
  "HU-B2 integra el fixture de seed + flujo completo de apertura/cierre de turno contra una base real",
  { skip: !DATABASE_URL, timeout: 30_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      turnoCaja,
      { ServiceError },
      { iniciarAuditLogListener },
      { verificarCadenaIntegridad },
      calculo,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./turno-caja.service.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../auditoria/audit-log.service.ts"),
      import("./turno-caja.calculo.ts"),
    ]);
    t.after(async () => prisma.$disconnect());
    iniciarAuditLogListener();

    // El listener de auditoría es fire-and-forget (regla no-negociable del
    // proyecto) — mismo patrón de espera ya usado en
    // `pedido-venta.integration.test.ts` para esperar su materialización
    // antes de aserir contra la fila real de `AuditLog`.
    async function esperarAuditLog(turnoCajaId: string, accion: string) {
      let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
      for (let intento = 0; intento < 20 && filas.length === 0; intento++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        filas = await prisma.auditLog.findMany({
          where: { tabla_afectada: "turnos_caja", registro_id: turnoCajaId, accion },
        });
      }
      return filas;
    }

    // ── 1. Fixture ya sembrado (solo lectura) — saldo_esperado contra datos
    //    REALES de VentaMedioPago, no sintéticos (ver hallazgo de cabecera) ──
    await t.test(
      "TURNO_CAJA_ABIERTO_ID: la agregación real de VentaMedioPago EFECTIVO coincide con calcularSaldoEsperado",
      async () => {
        const turno = await prisma.turnoCaja.findUniqueOrThrow({
          where: { id: TURNO_CAJA_ABIERTO_ID },
          select: { fondo_fijo_inicial: true, fecha_cierre: true, usuario_id: true },
        });
        assert.equal(turno.usuario_id, USUARIO_CAJERO_SEED_ID);
        assert.equal(turno.fecha_cierre, null); // turno abierto, sigue sin tocarse

        const agregado = await prisma.ventaMedioPago.aggregate({
          where: {
            medio: "EFECTIVO",
            is_active: true,
            pedido_venta: { turno_caja_id: TURNO_CAJA_ABIERTO_ID, is_active: true },
          },
          _sum: { importe: true },
        });
        const totalEfectivo = agregado._sum.importe?.toNumber() ?? 0;
        assert.equal(totalEfectivo, 20000); // VENTA_MEDIO_PAGO_EFECTIVO_ID del seed

        const saldoEsperado = calculo.calcularSaldoEsperado(
          turno.fondo_fijo_inicial.toNumber(),
          totalEfectivo,
        );
        assert.equal(saldoEsperado, 25000); // 5000 (fondo) + 20000 (efectivo real)
      },
    );

    // ── 2. TURNO_YA_ABIERTO contra el fixture real del seed ─────────────────
    await t.test("abrirTurnoCaja rechaza un segundo turno para cajero.seed (ya tiene uno abierto por el seed)", async () => {
      await assert.rejects(
        () => turnoCaja.abrirTurnoCaja(USUARIO_CAJERO_SEED_ID, { fondo_fijo_inicial: 1000 }),
        (err: unknown) => err instanceof ServiceError && err.code === "TURNO_YA_ABIERTO",
      );

      // El fixture compartido queda intacto — sigue habiendo un único turno
      // abierto para cajero.seed.
      const abiertos = await prisma.turnoCaja.count({
        where: { usuario_id: USUARIO_CAJERO_SEED_ID, fecha_cierre: null },
      });
      assert.equal(abiertos, 1);
    });

    // ── 3-9. Flujo ad-hoc completo con supervisor.ventas.seed ───────────────
    // (sin turno propio sembrado — libre para abrir/cerrar sin tocar ningún
    // fixture compartido; queda SIN turno abierto al final, re-ejecutable).

    let turnoAId = "";

    await t.test("abrirTurnoCaja abre un turno ad-hoc para supervisor.ventas.seed y emite venta:turno_abierto", async () => {
      let eventoEmitido: { turno_caja_id: string; usuario_id: string; fondo_fijo_inicial: number } | null = null;
      const { domainEventBus } = await import("../../events/domain-event-bus.ts");
      domainEventBus.once("venta:turno_abierto", (payload) => {
        eventoEmitido = payload;
      });

      const resultado = await turnoCaja.abrirTurnoCaja(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
        fondo_fijo_inicial: 3000,
      });
      turnoAId = resultado.turno_caja_id;

      assert.equal(resultado.fondo_fijo_inicial, 3000);
      assert.ok(resultado.fecha_apertura);

      assert.ok(eventoEmitido);
      const evento = eventoEmitido as unknown as { turno_caja_id: string; fondo_fijo_inicial: number };
      assert.equal(evento.turno_caja_id, turnoAId);
      assert.equal(evento.fondo_fijo_inicial, 3000);

      const filasAudit = await esperarAuditLog(turnoAId, "CREATE");
      assert.equal(filasAudit.length, 1);
    });

    await t.test("abrirTurnoCaja rechaza un segundo turno ad-hoc del mismo usuario (409 TURNO_YA_ABIERTO)", async () => {
      await assert.rejects(
        () => turnoCaja.abrirTurnoCaja(USUARIO_SUPERVISOR_VENTAS_SEED_ID, { fondo_fijo_inicial: 999 }),
        (err: unknown) => err instanceof ServiceError && err.code === "TURNO_YA_ABIERTO",
      );
    });

    await t.test("obtenerTurnoAbiertoDeUsuario refleja el turno A sin exponer saldo_esperado", async () => {
      const resumen = await turnoCaja.obtenerTurnoAbiertoDeUsuario(USUARIO_SUPERVISOR_VENTAS_SEED_ID);
      assert.ok(resumen);
      assert.equal(resumen!.turno_caja_id, turnoAId);
      assert.equal(resumen!.fondo_fijo_inicial, 3000);
      assert.equal("saldo_esperado" in (resumen as object), false);
    });

    await t.test("cierra el turno A dentro del umbral (diferencia <= 500): OK, sin justificación", async () => {
      // Venta en efectivo ad-hoc sobre el turno A para que saldo_esperado no
      // dependa únicamente del fondo inicial (mismo criterio que el fixture
      // del seed): fondo 3000 + efectivo 2000 = saldo_esperado 5000.
      await prisma.pedidoVenta.create({
        data: {
          numero_venta: `V-TEST-B2-A-${Date.now()}`,
          registrado_por_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID,
          turno_caja_id: turnoAId,
          estado: "FACTURADO",
          total: 2000,
          items: {
            create: {
              variante_sku_id: VARIANTE_BORCEGOS_2_ID,
              cantidad: 1,
              precio_unitario: 2000,
            },
          },
          medios_pago: { create: { medio: "EFECTIVO", importe: 2000 } },
        },
      });

      let eventoEmitido: {
        turno_caja_id: string;
        saldo_esperado: number;
        diferencia: number;
        requiere_justificacion: boolean;
      } | null = null;
      const { domainEventBus } = await import("../../events/domain-event-bus.ts");
      domainEventBus.once("venta:turno_cerrado", (payload) => {
        eventoEmitido = payload;
      });

      // saldo_esperado = 5000; conteo declarado = 4950 → diferencia = 50 (≤ 500).
      const resultado = await turnoCaja.cerrarTurnoCaja(turnoAId, USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
        conteo_fisico_declarado: 4950,
      });

      assert.equal(resultado.saldo_esperado, 5000);
      assert.equal(resultado.diferencia, 50);
      assert.equal(resultado.requiere_justificacion, false);
      assert.equal(resultado.justificacion, null);

      const turnoDb = await prisma.turnoCaja.findUniqueOrThrow({
        where: { id: turnoAId },
        select: { fecha_cierre: true, saldo_esperado: true, diferencia: true },
      });
      assert.notEqual(turnoDb.fecha_cierre, null);
      assert.equal(turnoDb.saldo_esperado?.toNumber(), 5000);
      assert.equal(turnoDb.diferencia?.toNumber(), 50);

      assert.ok(eventoEmitido);
      const evento = eventoEmitido as unknown as { requiere_justificacion: boolean };
      assert.equal(evento.requiere_justificacion, false);

      const filasAudit = await esperarAuditLog(turnoAId, "CIERRE_TURNO");
      assert.equal(filasAudit.length, 1);
    });

    await t.test("cerrarTurnoCaja rechaza un segundo cierre del turno A ya cerrado (409 TURNO_YA_CERRADO)", async () => {
      await assert.rejects(
        () =>
          turnoCaja.cerrarTurnoCaja(turnoAId, USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
            conteo_fisico_declarado: 5000,
          }),
        (err: unknown) => err instanceof ServiceError && err.code === "TURNO_YA_CERRADO",
      );
    });

    await t.test("cerrarTurnoCaja rechaza un turno_caja_id inexistente (404 TURNO_NO_ENCONTRADO)", async () => {
      await assert.rejects(
        () =>
          turnoCaja.cerrarTurnoCaja(
            "00000000-0000-4000-8000-000000000000",
            USUARIO_SUPERVISOR_VENTAS_SEED_ID,
            { conteo_fisico_declarado: 100 },
          ),
        (err: unknown) => err instanceof ServiceError && err.code === "TURNO_NO_ENCONTRADO",
      );
    });

    let turnoBId = "";

    await t.test("abre el turno B ad-hoc (supervisor.ventas.seed, ahora sin turno abierto tras cerrar A)", async () => {
      const resultado = await turnoCaja.abrirTurnoCaja(USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
        fondo_fijo_inicial: 1000,
      });
      turnoBId = resultado.turno_caja_id;
    });

    await t.test("cerrarTurnoCaja rechaza el cierre de otro usuario sobre el turno B (403 SIN_PERMISO_CIERRE)", async () => {
      await assert.rejects(
        () =>
          turnoCaja.cerrarTurnoCaja(turnoBId, USUARIO_CAJERO_SEED_ID, {
            conteo_fisico_declarado: 1000,
          }),
        (err: unknown) => err instanceof ServiceError && err.code === "SIN_PERMISO_CIERRE",
      );

      // El turno B sigue abierto — el rechazo ocurrió antes de cualquier UPDATE.
      const turnoDb = await prisma.turnoCaja.findUniqueOrThrow({
        where: { id: turnoBId },
        select: { fecha_cierre: true },
      });
      assert.equal(turnoDb.fecha_cierre, null);
    });

    await t.test(
      "cerrarTurnoCaja rechaza el cierre fuera del umbral SIN justificación (422 JUSTIFICACION_REQUERIDA), sin cerrar el turno",
      async () => {
        // saldo_esperado = 1000 (solo fondo, sin ventas); conteo declarado =
        // 200 → diferencia = 800 (> 500) sin justificación.
        await assert.rejects(
          () =>
            turnoCaja.cerrarTurnoCaja(turnoBId, USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
              conteo_fisico_declarado: 200,
            }),
          (err: unknown) => err instanceof ServiceError && err.code === "JUSTIFICACION_REQUERIDA",
        );

        const turnoDb = await prisma.turnoCaja.findUniqueOrThrow({
          where: { id: turnoBId },
          select: { fecha_cierre: true, saldo_esperado: true },
        });
        assert.equal(turnoDb.fecha_cierre, null); // el turno NO se cerró
        assert.equal(turnoDb.saldo_esperado, null); // tampoco se persistió el cálculo
      },
    );

    await t.test(
      "cerrarTurnoCaja reintentado CON justificación cierra el turno (200) — evento sensible",
      async () => {
        let eventoEmitido: {
          diferencia: number;
          requiere_justificacion: boolean;
          justificacion: string | null;
        } | null = null;
        const { domainEventBus } = await import("../../events/domain-event-bus.ts");
        domainEventBus.once("venta:turno_cerrado", (payload) => {
          eventoEmitido = payload;
        });

        const resultado = await turnoCaja.cerrarTurnoCaja(turnoBId, USUARIO_SUPERVISOR_VENTAS_SEED_ID, {
          conteo_fisico_declarado: 200,
          justificacion: "Faltante detectado — vuelto entregado de más, reportado a Supervisión",
        });

        assert.equal(resultado.saldo_esperado, 1000);
        assert.equal(resultado.diferencia, 800);
        assert.equal(resultado.requiere_justificacion, true);
        assert.equal(
          resultado.justificacion,
          "Faltante detectado — vuelto entregado de más, reportado a Supervisión",
        );

        const turnoDb = await prisma.turnoCaja.findUniqueOrThrow({
          where: { id: turnoBId },
          select: { fecha_cierre: true, justificacion: true },
        });
        assert.notEqual(turnoDb.fecha_cierre, null);
        assert.equal(
          turnoDb.justificacion,
          "Faltante detectado — vuelto entregado de más, reportado a Supervisión",
        );

        assert.ok(eventoEmitido);
        const evento = eventoEmitido as unknown as { requiere_justificacion: boolean };
        assert.equal(evento.requiere_justificacion, true);

        // Evento SENSIBLE: accion distinta a la del cierre sin justificación.
        const filasAudit = await esperarAuditLog(turnoBId, "CIERRE_TURNO_CON_JUSTIFICACION");
        assert.equal(filasAudit.length, 1);
        const valorNuevo = filasAudit[0]!.valor_nuevo as {
          requiere_justificacion?: boolean;
          justificacion?: string;
        } | null;
        assert.equal(valorNuevo?.requiere_justificacion, true);
        assert.equal(
          valorNuevo?.justificacion,
          "Faltante detectado — vuelto entregado de más, reportado a Supervisión",
        );
      },
    );

    // ── 10. Integridad de la cadena SHA-256 del ledger completo ─────────────
    await t.test("verificarCadenaIntegridad confirma que el ledger completo (incluyendo los eventos de HU-B2) sigue íntegro", async () => {
      const resultado = await verificarCadenaIntegridad();
      assert.equal(resultado.integra, true, JSON.stringify(resultado));
    });
  },
);
