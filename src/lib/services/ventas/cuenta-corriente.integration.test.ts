import assert from "node:assert/strict";
import test from "node:test";

/**
 * Test de integración de HU-B5 contra una base real (mismo patrón que
 * `pedido-venta.integration.test.ts`: `skip` si no hay
 * `HU_B5_INTEGRATION_DATABASE_URL`, imports dinámicos porque
 * `cuenta-corriente.service.ts` usa `import "server-only"`).
 *
 * Cubre a nivel de servicio (sin HTTP) el Nivel 1 "de comportamiento" y el
 * Nivel 3 del task file:
 *  - Fixture RETENIDA real de seed (`CUENTA_CORRIENTE_OPERACION_RETENIDA_ID`)
 *    resuelto en DOS corridas separadas — APROBAR y RECHAZAR — reseteando el
 *    fixture entre una y otra con `UPDATE` (nunca `DELETE`, RULES.md Regla N.° 1).
 *    El seed usa `upsert` con `update: {}`, así que volver a sembrar NO
 *    restaura el fixture: el reseteo vive acá y se repite en `t.after`.
 *  - `saldo_actual` de la cuenta se actualiza solo al aprobar.
 *  - El evento sensible queda encadenado en `AuditLog` (hash SHA-256
 *    recalculado + enlace con el registro previo) con el `autorizacion_id`
 *    de correlación devuelto por el servicio.
 *  - Altas dentro/fuera de límite, validaciones 404/422 y concurrencia
 *    (`FOR UPDATE` en el alta, guardia `updateMany` en la resolución).
 *
 * Las altas ad-hoc crean sus propios `PedidoVenta` (mismo criterio que B4) y
 * al final se dan de baja lógica (`is_active: false`), con el saldo de la
 * cuenta de Juan Pérez restaurado a su valor de seed.
 *
 * Corre con: `npm run test:integration:b5` (opt-in, requiere una base
 * accesible con el seed ya aplicado).
 */

const DATABASE_URL = process.env.HU_B5_INTEGRATION_DATABASE_URL;

// IDs fijos del seed (prisma/seed.ts).
const CLIENTE_JUAN_PEREZ_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000001";
const CUENTA_CORRIENTE_JUAN_PEREZ_ID = "1a2b3c4d-be09-4a1a-8a1a-000000000001";
const OPERACION_APROBADA_ID = "1a2b3c4d-be10-4a1a-8a1a-000000000001";
const OPERACION_RETENIDA_ID = "1a2b3c4d-be10-4a1a-8a1a-000000000002";
const PEDIDO_VENTA_REMITO_PARCIAL_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000003"; // V-2026-000003
const PEDIDO_VENTA_LICITACION_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000002"; // V-2026-000002, otro cliente
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";

const LIMITE_SEED = 500000;
const SALDO_SEED = 120000;
const MONTO_RETENIDA_SEED = 413000;

test(
  "HU-B5 — cuenta corriente: fixture de seed + registrar/resolver contra una base real",
  { skip: !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;

    const [
      { prisma },
      cc,
      { ServiceError },
      { iniciarAuditLogListener },
      { domainEventBus },
      { calcularHashEncadenado, HASH_GENESIS },
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./cuenta-corriente.service.ts"),
      import("../../errors/service-error.ts"),
      import("../../events/listeners/audit-log.listener.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../crypto/hash-chain.ts"),
    ]);
    iniciarAuditLogListener();

    const pedidosAdHoc: string[] = [];
    const operacionesAdHoc: string[] = [];

    async function resetFixture() {
      // UPDATE (nunca DELETE): devuelve el fixture RETENIDA y la cuenta a su estado de seed.
      await prisma.cuentaCorrienteOperacion.update({
        where: { id: OPERACION_RETENIDA_ID },
        data: { estado: "RETENIDA", autorizado_por_id: null },
      });
      await prisma.cuentaCorrienteCliente.update({
        where: { id: CUENTA_CORRIENTE_JUAN_PEREZ_ID },
        data: { saldo_actual: SALDO_SEED },
      });
    }

    async function crearPedidoAdHoc(overrides: { estado?: "RESERVADO" | "ANULADO"; is_active?: boolean } = {}) {
      const pedido = await prisma.pedidoVenta.create({
        data: {
          numero_venta: `V-TEST-B5-${Date.now()}-${pedidosAdHoc.length}`,
          cliente_id: CLIENTE_JUAN_PEREZ_ID,
          registrado_por_id: USUARIO_CAJERO_SEED_ID,
          estado: overrides.estado ?? "RESERVADO",
          is_active: overrides.is_active ?? true,
          total: 1000,
        },
        select: { id: true },
      });
      pedidosAdHoc.push(pedido.id);
      return pedido.id;
    }

    async function saldoActual() {
      const c = await prisma.cuentaCorrienteCliente.findUniqueOrThrow({
        where: { id: CUENTA_CORRIENTE_JUAN_PEREZ_ID },
        select: { saldo_actual: true },
      });
      return c.saldo_actual.toNumber();
    }

    async function esperarAuditLog(operacionId: string, accion: string) {
      let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
      for (let intento = 0; intento < 40 && filas.length === 0; intento++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        filas = await prisma.auditLog.findMany({
          where: { tabla_afectada: "cuenta_corriente_operaciones", registro_id: operacionId, accion },
        });
      }
      return filas;
    }

    t.after(async () => {
      // Limpieza por baja lógica + restauración del fixture. Sin DELETE.
      if (operacionesAdHoc.length > 0) {
        await prisma.cuentaCorrienteOperacion.updateMany({
          where: { id: { in: operacionesAdHoc } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B5" },
        });
      }
      if (pedidosAdHoc.length > 0) {
        await prisma.pedidoVenta.updateMany({
          where: { id: { in: pedidosAdHoc } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B5" },
        });
      }
      await resetFixture();
      await prisma.$disconnect();
    });

    // Punto de partida garantizado, aunque una corrida anterior haya quedado a medias.
    await resetFixture();

    // ── 1. Fixture de seed (solo lectura) ───────────────────────────────────
    await t.test("fixture: cuenta de Juan Pérez 500000/120000, operación APROBADA y operación RETENIDA sin resolver", async () => {
      const cuenta = await cc.consultarCuentaCorriente(CLIENTE_JUAN_PEREZ_ID);
      assert.deepEqual(cuenta, {
        cliente_id: CLIENTE_JUAN_PEREZ_ID,
        limite_credito_autorizado: LIMITE_SEED,
        saldo_actual: SALDO_SEED,
        disponible: LIMITE_SEED - SALDO_SEED,
      });

      const aprobada = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id: OPERACION_APROBADA_ID } });
      assert.equal(aprobada.estado, "APROBADA");
      const retenida = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id: OPERACION_RETENIDA_ID } });
      assert.equal(retenida.estado, "RETENIDA");
      assert.equal(retenida.autorizado_por_id, null);
      assert.equal(retenida.pedido_venta_id, PEDIDO_VENTA_REMITO_PARCIAL_ID);
      assert.equal(retenida.monto.toNumber(), MONTO_RETENIDA_SEED);
    });

    await t.test("consultarCuentaCorriente: cliente sin cuenta → CUENTA_CORRIENTE_NO_ENCONTRADA", async () => {
      await assert.rejects(
        () => cc.consultarCuentaCorriente("00000000-0000-4000-8000-000000000000"),
        (err: unknown) => err instanceof ServiceError && err.code === "CUENTA_CORRIENTE_NO_ENCONTRADA",
      );
    });

    // ── 2. registrarOperacionCuentaCorriente ────────────────────────────────
    await t.test("dentro del límite → APROBADA, saldo_actual sube, evento emitido post-COMMIT (con plan_de_pagos)", async () => {
      const pedidoId = await crearPedidoAdHoc();
      const eventos: Array<Record<string, unknown>> = [];
      const handler = (p: object) => eventos.push(p as Record<string, unknown>);
      domainEventBus.on("venta:operacion_cuenta_corriente_registrada", handler);

      const antes = await saldoActual();
      const res = await cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, {
        pedido_venta_id: pedidoId,
        monto: 10000,
        plan_de_pagos: [
          { hito: "Anticipo", porcentaje: 40, fecha_estimada: new Date("2026-11-01T00:00:00.000Z") },
          { hito: "Entrega", porcentaje: 60 },
        ],
      });
      domainEventBus.off("venta:operacion_cuenta_corriente_registrada", handler);
      operacionesAdHoc.push(res.operacion_id);

      assert.equal(res.estado, "APROBADA");
      assert.equal(await saldoActual(), antes + 10000);

      const fila = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id: res.operacion_id } });
      assert.equal(fila.estado, "APROBADA");
      assert.equal(fila.autorizado_por_id, null);
      const plan = fila.plan_de_pagos as Array<{ hito: string; porcentaje: number; fecha_estimada?: string }>;
      assert.equal(plan.length, 2);
      assert.equal(plan[0]!.fecha_estimada, "2026-11-01T00:00:00.000Z");

      assert.equal(eventos.length, 1);
      assert.equal(eventos[0]!.estado, "APROBADA");
      assert.equal(eventos[0]!.operacion_id, res.operacion_id);
      assert.equal(eventos[0]!.monto, 10000);

      await resetFixture();
    });

    await t.test("fuera del límite → RETENIDA persistida, saldo intacto, LIMITE_CREDITO_EXCEDIDO con details.operacion_id, evento emitido", async () => {
      const pedidoId = await crearPedidoAdHoc();
      const eventos: Array<Record<string, unknown>> = [];
      const handler = (p: object) => eventos.push(p as Record<string, unknown>);
      domainEventBus.on("venta:operacion_cuenta_corriente_registrada", handler);

      const antes = await saldoActual();
      let operacionId = "";
      await assert.rejects(
        () => cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, { pedido_venta_id: pedidoId, monto: 380000.01 }),
        (err: unknown) => {
          assert.ok(err instanceof ServiceError);
          assert.equal(err.code, "LIMITE_CREDITO_EXCEDIDO");
          operacionId = (err.details as { operacion_id: string }).operacion_id;
          return true;
        },
      );
      domainEventBus.off("venta:operacion_cuenta_corriente_registrada", handler);
      operacionesAdHoc.push(operacionId);

      // La operación RETENIDA ya está committeada al lanzar el error.
      const fila = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id: operacionId } });
      assert.equal(fila.estado, "RETENIDA");
      assert.equal(fila.autorizado_por_id, null);
      assert.equal(await saldoActual(), antes);
      assert.equal(eventos.length, 1);
      assert.equal(eventos[0]!.estado, "RETENIDA");
    });

    await t.test("monto exactamente igual al disponible → APROBADA (límite inclusivo)", async () => {
      const pedidoId = await crearPedidoAdHoc();
      const res = await cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, {
        pedido_venta_id: pedidoId,
        monto: LIMITE_SEED - SALDO_SEED,
      });
      operacionesAdHoc.push(res.operacion_id);
      assert.equal(res.estado, "APROBADA");
      assert.equal(await saldoActual(), LIMITE_SEED);
      await resetFixture();
    });

    await t.test("validaciones: cuenta inexistente, pedido inexistente, pedido de otro cliente, pedido ANULADO/inactivo", async () => {
      const pedidoOk = await crearPedidoAdHoc();
      const sinCuenta = "00000000-0000-4000-8000-000000000000";
      await assert.rejects(
        () => cc.registrarOperacionCuentaCorriente(sinCuenta, { pedido_venta_id: pedidoOk, monto: 1 }),
        (e: unknown) => e instanceof ServiceError && e.code === "CUENTA_CORRIENTE_NO_ENCONTRADA",
      );
      await assert.rejects(
        () => cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, { pedido_venta_id: sinCuenta, monto: 1 }),
        (e: unknown) => e instanceof ServiceError && e.code === "PEDIDO_VENTA_NO_ENCONTRADO",
      );
      await assert.rejects(
        () => cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, { pedido_venta_id: PEDIDO_VENTA_LICITACION_ID, monto: 1 }),
        (e: unknown) => e instanceof ServiceError && e.code === "PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE",
      );
      const anulado = await crearPedidoAdHoc({ estado: "ANULADO", is_active: false });
      await assert.rejects(
        () => cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, { pedido_venta_id: anulado, monto: 1 }),
        (e: unknown) => e instanceof ServiceError && e.code === "PEDIDO_VENTA_NO_OPERABLE",
      );
      // Ninguna de las validaciones fallidas dejó rastro en el saldo.
      assert.equal(await saldoActual(), SALDO_SEED);
    });

    await t.test("concurrencia: dos altas simultáneas de 250000 con 380000 disponibles → una APROBADA y una RETENIDA (FOR UPDATE)", async () => {
      const [p1, p2] = [await crearPedidoAdHoc(), await crearPedidoAdHoc()];
      const resultados = await Promise.allSettled([
        cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, { pedido_venta_id: p1, monto: 250000 }),
        cc.registrarOperacionCuentaCorriente(CLIENTE_JUAN_PEREZ_ID, { pedido_venta_id: p2, monto: 250000 }),
      ]);

      const aprobadas = resultados.filter((r) => r.status === "fulfilled");
      const retenidas = resultados.filter(
        (r) => r.status === "rejected" && r.reason instanceof ServiceError && r.reason.code === "LIMITE_CREDITO_EXCEDIDO",
      );
      assert.equal(aprobadas.length, 1, JSON.stringify(resultados.map((r) => r.status)));
      assert.equal(retenidas.length, 1);
      for (const r of resultados) {
        if (r.status === "fulfilled") operacionesAdHoc.push(r.value.operacion_id);
        else operacionesAdHoc.push((r.reason.details as { operacion_id: string }).operacion_id);
      }
      // Solo la aprobada sumó al saldo.
      assert.equal(await saldoActual(), SALDO_SEED + 250000);
      await resetFixture();
    });

    // ── 3. resolverExcepcionCredito sobre el fixture RETENIDA real ──────────
    for (const decision of ["APROBAR", "RECHAZAR"] as const) {
      await t.test(`fixture RETENIDA: ${decision} — corrida independiente sobre el fixture reseteado`, async () => {
        await resetFixture();
        const aprobar = decision === "APROBAR";

        const eventos: Array<Record<string, unknown>> = [];
        const handler = (p: object) => eventos.push(p as Record<string, unknown>);
        domainEventBus.on("venta:excepcion_credito_resuelta", handler);

        const res = await cc.resolverExcepcionCredito(
          OPERACION_RETENIDA_ID,
          { decision, motivo: `motivo test ${decision}` },
          USUARIO_SUPERVISOR_VENTAS_SEED_ID,
        );
        domainEventBus.off("venta:excepcion_credito_resuelta", handler);

        // Respuesta del contrato §2.3.
        assert.equal(res.operacion_id, OPERACION_RETENIDA_ID);
        assert.equal(res.estado, aprobar ? "APROBADA" : "RECHAZADA");
        assert.match(res.autorizacion_id, /^[0-9a-f-]{36}$/);

        // Estado de la operación + saldo.
        const fila = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id: OPERACION_RETENIDA_ID } });
        assert.equal(fila.estado, aprobar ? "APROBADA" : "RECHAZADA");
        assert.equal(fila.autorizado_por_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
        assert.equal(
          await saldoActual(),
          aprobar ? SALDO_SEED + MONTO_RETENIDA_SEED : SALDO_SEED,
          "el saldo solo debe cambiar al APROBAR (533000, por encima del límite, es el comportamiento esperado)",
        );

        // Evento emitido con el payload completo (solicitante = registrado_por_id del pedido).
        assert.equal(eventos.length, 1);
        assert.deepEqual(eventos[0], {
          autorizacion_id: res.autorizacion_id,
          operacion_id: OPERACION_RETENIDA_ID,
          pedido_venta_id: PEDIDO_VENTA_REMITO_PARCIAL_ID,
          cliente_id: CLIENTE_JUAN_PEREZ_ID,
          usuario_solicitante_id: USUARIO_CAJERO_SEED_ID,
          usuario_autorizante_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID,
          decision,
          motivo: `motivo test ${decision}`,
          monto: MONTO_RETENIDA_SEED,
        });

        // AuditLog: fila materializada por el listener, con el id de correlación en valor_nuevo.
        const accion = aprobar ? "EXCEPCION_CREDITO_APROBADA" : "EXCEPCION_CREDITO_RECHAZADA";
        const filasAudit = (await esperarAuditLog(OPERACION_RETENIDA_ID, accion)).filter(
          (f) => (f.valor_nuevo as { autorizacion_id?: string } | null)?.autorizacion_id === res.autorizacion_id,
        );
        assert.equal(filasAudit.length, 1, "el evento sensible debe quedar en AuditLog con el autorizacion_id de correlación");
        const audit = filasAudit[0]!;
        assert.equal(audit.usuario_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
        const vn = audit.valor_nuevo as Record<string, unknown>;
        assert.equal(vn.usuario_solicitante_id, USUARIO_CAJERO_SEED_ID);
        assert.equal(vn.decision, decision);
        assert.equal(vn.motivo, `motivo test ${decision}`);
        assert.equal(vn.monto, MONTO_RETENIDA_SEED);
        assert.deepEqual(audit.valor_anterior, { estado: "RETENIDA" });

        // Encadenamiento SHA-256: hash recalculado + enlace con el registro previo del ledger.
        assert.match(audit.hash_actual, /^[0-9a-f]{64}$/);
        const recalculado = calcularHashEncadenado(
          {
            usuario_id: audit.usuario_id,
            accion: audit.accion,
            tabla_afectada: audit.tabla_afectada,
            registro_id: audit.registro_id,
            ip: audit.ip,
            valor_anterior: audit.valor_anterior,
            valor_nuevo: audit.valor_nuevo,
          },
          audit.hash_anterior,
        );
        assert.equal(audit.hash_actual, recalculado);
        const previo = await prisma.auditLog.findFirst({
          where: { created_at: { lt: audit.created_at } },
          orderBy: { created_at: "desc" },
          select: { hash_actual: true },
        });
        assert.equal(audit.hash_anterior, previo?.hash_actual ?? HASH_GENESIS);

        // Transición inválida: la operación ya resuelta no admite otra resolución (y no toca el saldo).
        const saldoTrasResolver = await saldoActual();
        for (const d of ["APROBAR", "RECHAZAR"] as const) {
          await assert.rejects(
            () => cc.resolverExcepcionCredito(OPERACION_RETENIDA_ID, { decision: d, motivo: "reintento" }, USUARIO_SUPERVISOR_VENTAS_SEED_ID),
            (e: unknown) => e instanceof ServiceError && e.code === "TRANSICION_INVALIDA",
          );
        }
        assert.equal(await saldoActual(), saldoTrasResolver);
      });
    }

    await t.test("resolver: una operación APROBADA (fixture) y una inexistente → TRANSICION_INVALIDA / OPERACION_..._NO_ENCONTRADA", async () => {
      await assert.rejects(
        () => cc.resolverExcepcionCredito(OPERACION_APROBADA_ID, { decision: "APROBAR", motivo: "x" }, USUARIO_SUPERVISOR_VENTAS_SEED_ID),
        (e: unknown) => e instanceof ServiceError && e.code === "TRANSICION_INVALIDA",
      );
      await assert.rejects(
        () => cc.resolverExcepcionCredito("00000000-0000-4000-8000-000000000000", { decision: "APROBAR", motivo: "x" }, USUARIO_SUPERVISOR_VENTAS_SEED_ID),
        (e: unknown) => e instanceof ServiceError && e.code === "OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA",
      );
    });

    await t.test("concurrencia: dos resoluciones simultáneas de la misma RETENIDA → una gana, la otra TRANSICION_INVALIDA; el saldo suma una sola vez", async () => {
      await resetFixture();
      const resultados = await Promise.allSettled([
        cc.resolverExcepcionCredito(OPERACION_RETENIDA_ID, { decision: "APROBAR", motivo: "A" }, USUARIO_SUPERVISOR_VENTAS_SEED_ID),
        cc.resolverExcepcionCredito(OPERACION_RETENIDA_ID, { decision: "APROBAR", motivo: "B" }, USUARIO_SUPERVISOR_VENTAS_SEED_ID),
      ]);
      assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
      const rechazada = resultados.find((r) => r.status === "rejected");
      assert.ok(rechazada && rechazada.status === "rejected");
      assert.ok(rechazada.reason instanceof ServiceError && rechazada.reason.code === "TRANSICION_INVALIDA");
      assert.equal(await saldoActual(), SALDO_SEED + MONTO_RETENIDA_SEED);
      await resetFixture();
    });
  },
);
