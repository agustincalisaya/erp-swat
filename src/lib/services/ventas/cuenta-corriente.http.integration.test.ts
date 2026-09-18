import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-B5 (Nivel 2 del task file) — mismo
 * patrón y motivo que `pedido-venta.http.integration.test.ts`:
 * `withPermission()` depende de `cookies()` de `next/headers`, así que
 * 401/403 de sesión real solo se prueban contra un servidor real
 * (`npm run dev` / `next start`), no invocando el `route.ts` a mano.
 *
 * Login real con `cajero.seed` / `supervisor.ventas.seed`:
 *  - GET consulta de cuenta: 401 sin sesión · 400 uuid inválido · 404 sin cuenta · 200.
 *  - POST alta de operación: 401 · 400 body inválido · 201 dentro de límite ·
 *    422 LIMITE_CREDITO_EXCEDIDO con `error.details.operacion_id` (operación
 *    RETENIDA ya persistida) · 404/422 de validaciones.
 *  - PATCH resolver: 401 sin sesión · 403 con `cajero.seed` (incluso sobre SU
 *    PROPIA operación retenida) · 400 motivo vacío · 200 con
 *    `supervisor.ventas.seed` (aprobar y rechazar) · 409 al repetir · 404.
 *
 * El fixture RETENIDA de seed se resuelve por HTTP y se resetea con `UPDATE`
 * antes/después (nunca `DELETE`). Las altas ad-hoc crean sus propios
 * `PedidoVenta` y se dan de baja lógica al terminar.
 *
 * Opt-in: `HU_B5_INTEGRATION_BASE_URL` (ej. "http://localhost:3100") +
 * `HU_B5_INTEGRATION_DATABASE_URL` (misma base a la que apunta el servidor);
 * `skip` si falta alguna. Corre con `npm run test:integration:b5-http`.
 */

const BASE_URL = process.env.HU_B5_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_B5_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";

const CLIENTE_JUAN_PEREZ_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000001";
const CUENTA_CORRIENTE_JUAN_PEREZ_ID = "1a2b3c4d-be09-4a1a-8a1a-000000000001";
const OPERACION_RETENIDA_ID = "1a2b3c4d-be10-4a1a-8a1a-000000000002";
const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";
const SALDO_SEED = 120000;
const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

async function loginReal(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login falló para ${email}: ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login para ${email} no devolvió cookie de sesión`);
  return setCookie!.split(";")[0]!;
}

test(
  "HU-B5 — endpoints de cuenta corriente contra un servidor real (401/403/200/201/400/404/409/422)",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const { prisma } = await import("../../db/prisma.ts");

    const pedidosAdHoc: string[] = [];
    const operacionesAdHoc: string[] = [];

    async function resetFixture() {
      await prisma.cuentaCorrienteOperacion.update({
        where: { id: OPERACION_RETENIDA_ID },
        data: { estado: "RETENIDA", autorizado_por_id: null },
      });
      await prisma.cuentaCorrienteCliente.update({
        where: { id: CUENTA_CORRIENTE_JUAN_PEREZ_ID },
        data: { saldo_actual: SALDO_SEED },
      });
    }

    async function crearPedidoAdHoc() {
      const pedido = await prisma.pedidoVenta.create({
        data: {
          numero_venta: `V-TEST-B5-HTTP-${Date.now()}-${pedidosAdHoc.length}`,
          cliente_id: CLIENTE_JUAN_PEREZ_ID,
          registrado_por_id: USUARIO_CAJERO_SEED_ID,
          estado: "RESERVADO",
          total: 1000,
        },
        select: { id: true },
      });
      pedidosAdHoc.push(pedido.id);
      return pedido.id;
    }

    t.after(async () => {
      if (operacionesAdHoc.length > 0) {
        await prisma.cuentaCorrienteOperacion.updateMany({
          where: { id: { in: operacionesAdHoc } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B5 http" },
        });
      }
      if (pedidosAdHoc.length > 0) {
        await prisma.pedidoVenta.updateMany({
          where: { id: { in: pedidosAdHoc } },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "cleanup test HU-B5 http" },
        });
      }
      await resetFixture();
      await prisma.$disconnect();
    });

    await resetFixture();

    const cookieCajero = await loginReal("cajero.seed@erp-swat.local");
    const cookieSupervisor = await loginReal("supervisor.ventas.seed@erp-swat.local");
    const json = (cookie?: string) => ({
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    });
    const urlCuenta = `${BASE_URL}/api/ventas/cuentas-corrientes/${CLIENTE_JUAN_PEREZ_ID}`;
    const urlResolver = (id: string) => `${BASE_URL}/api/ventas/cuentas-corrientes/operaciones/${id}/resolver`;

    // ── GET (2.1) ───────────────────────────────────────────────────────────
    await t.test("GET consulta sin sesión → 401", async () => {
      const res = await fetch(urlCuenta);
      assert.equal(res.status, 401);
    });

    await t.test("GET con cajero.seed y con supervisor.ventas.seed → 200 con el shape de spec §2.5", async () => {
      for (const cookie of [cookieCajero, cookieSupervisor]) {
        const res = await fetch(urlCuenta, { headers: json(cookie) });
        const body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.deepEqual(body, {
          data: {
            cliente_id: CLIENTE_JUAN_PEREZ_ID,
            limite_credito_autorizado: 500000,
            saldo_actual: 120000,
            disponible: 380000,
          },
          error: null,
        });
      }
    });

    await t.test("GET con uuid inválido → 400 · cliente sin cuenta → 404", async () => {
      const malo = await fetch(`${BASE_URL}/api/ventas/cuentas-corrientes/no-es-uuid`, { headers: json(cookieCajero) });
      assert.equal(malo.status, 400);
      const ausente = await fetch(`${BASE_URL}/api/ventas/cuentas-corrientes/${UUID_INEXISTENTE}`, { headers: json(cookieCajero) });
      const body = await ausente.json();
      assert.equal(ausente.status, 404);
      assert.equal(body.error.code, "CUENTA_CORRIENTE_NO_ENCONTRADA");
    });

    // ── POST (2.2) ──────────────────────────────────────────────────────────
    await t.test("POST alta sin sesión → 401", async () => {
      const res = await fetch(`${urlCuenta}/operaciones`, {
        method: "POST",
        headers: json(),
        body: JSON.stringify({ pedido_venta_id: UUID_INEXISTENTE, monto: 1 }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("POST con body inválido → 400 · pedido inexistente → 404 · pedido de otro cliente → 422", async () => {
      const invalido = await fetch(`${urlCuenta}/operaciones`, {
        method: "POST",
        headers: json(cookieCajero),
        body: JSON.stringify({ pedido_venta_id: UUID_INEXISTENTE, monto: -1 }),
      });
      assert.equal(invalido.status, 400);

      const inexistente = await fetch(`${urlCuenta}/operaciones`, {
        method: "POST",
        headers: json(cookieCajero),
        body: JSON.stringify({ pedido_venta_id: UUID_INEXISTENTE, monto: 1 }),
      });
      assert.equal(inexistente.status, 404);
      assert.equal((await inexistente.json()).error.code, "PEDIDO_VENTA_NO_ENCONTRADO");

      const otroCliente = await fetch(`${urlCuenta}/operaciones`, {
        method: "POST",
        headers: json(cookieCajero),
        body: JSON.stringify({ pedido_venta_id: "1a2b3c4d-be02-4a1a-8a1a-000000000002", monto: 1 }),
      });
      assert.equal(otroCliente.status, 422);
      assert.equal((await otroCliente.json()).error.code, "PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE");
    });

    await t.test("POST dentro del límite con cajero.seed → 201 APROBADA", async () => {
      const pedidoId = await crearPedidoAdHoc();
      const res = await fetch(`${urlCuenta}/operaciones`, {
        method: "POST",
        headers: json(cookieCajero),
        body: JSON.stringify({
          pedido_venta_id: pedidoId,
          monto: 5000,
          plan_de_pagos: [{ hito: "Entrega", porcentaje: 100, fecha_estimada: "2026-12-01" }],
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.data.estado, "APROBADA");
      assert.equal(body.error, null);
      operacionesAdHoc.push(body.data.operacion_id);
      await resetFixture();
    });

    let operacionRetenidaCajeroId = "";
    await t.test("POST fuera del límite → 422 LIMITE_CREDITO_EXCEDIDO con error.details.operacion_id; la operación queda RETENIDA en BD", async () => {
      const pedidoId = await crearPedidoAdHoc();
      const res = await fetch(`${urlCuenta}/operaciones`, {
        method: "POST",
        headers: json(cookieCajero),
        body: JSON.stringify({ pedido_venta_id: pedidoId, monto: 400000 }),
      });
      const body = await res.json();
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(body.data, null);
      assert.equal(body.error.code, "LIMITE_CREDITO_EXCEDIDO");
      operacionRetenidaCajeroId = body.error.details.operacion_id;
      assert.match(operacionRetenidaCajeroId, /^[0-9a-f-]{36}$/);
      operacionesAdHoc.push(operacionRetenidaCajeroId);

      const fila = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id: operacionRetenidaCajeroId } });
      assert.equal(fila.estado, "RETENIDA");
      assert.equal(fila.autorizado_por_id, null);
      const cuenta = await prisma.cuentaCorrienteCliente.findUniqueOrThrow({ where: { id: CUENTA_CORRIENTE_JUAN_PEREZ_ID } });
      assert.equal(cuenta.saldo_actual.toNumber(), SALDO_SEED);
    });

    // ── PATCH (2.3) ─────────────────────────────────────────────────────────
    await t.test("PATCH resolver sin sesión → 401", async () => {
      const res = await fetch(urlResolver(OPERACION_RETENIDA_ID), {
        method: "PATCH",
        headers: json(),
        body: JSON.stringify({ decision: "APROBAR", motivo: "x" }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("PATCH resolver con cajero.seed → 403, incluso sobre su PROPIA operación retenida (que sigue RETENIDA)", async () => {
      for (const id of [OPERACION_RETENIDA_ID, operacionRetenidaCajeroId]) {
        const res = await fetch(urlResolver(id), {
          method: "PATCH",
          headers: json(cookieCajero),
          body: JSON.stringify({ decision: "APROBAR", motivo: "me la apruebo yo" }),
        });
        assert.equal(res.status, 403, await res.clone().text());
        const fila = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id } });
        assert.equal(fila.estado, "RETENIDA");
      }
    });

    await t.test("PATCH con supervisor: motivo vacío → 400 · id inválido → 400 · id inexistente → 404", async () => {
      const sinMotivo = await fetch(urlResolver(OPERACION_RETENIDA_ID), {
        method: "PATCH",
        headers: json(cookieSupervisor),
        body: JSON.stringify({ decision: "APROBAR", motivo: "" }),
      });
      assert.equal(sinMotivo.status, 400);
      const idMalo = await fetch(urlResolver("no-es-uuid"), {
        method: "PATCH",
        headers: json(cookieSupervisor),
        body: JSON.stringify({ decision: "APROBAR", motivo: "x" }),
      });
      assert.equal(idMalo.status, 400);
      const inexistente = await fetch(urlResolver(UUID_INEXISTENTE), {
        method: "PATCH",
        headers: json(cookieSupervisor),
        body: JSON.stringify({ decision: "APROBAR", motivo: "x" }),
      });
      assert.equal(inexistente.status, 404);
      assert.equal((await inexistente.json()).error.code, "OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA");
    });

    for (const decision of ["APROBAR", "RECHAZAR"] as const) {
      await t.test(`PATCH con supervisor.ventas.seed sobre el fixture RETENIDA: ${decision} → 200 · repetir → 409 TRANSICION_INVALIDA`, async () => {
        await resetFixture();
        const aprobar = decision === "APROBAR";
        const res = await fetch(urlResolver(OPERACION_RETENIDA_ID), {
          method: "PATCH",
          headers: json(cookieSupervisor),
          body: JSON.stringify({ decision, motivo: `http ${decision}` }),
        });
        const body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.equal(body.error, null);
        assert.equal(body.data.operacion_id, OPERACION_RETENIDA_ID);
        assert.equal(body.data.estado, aprobar ? "APROBADA" : "RECHAZADA");
        assert.match(body.data.autorizacion_id, /^[0-9a-f-]{36}$/);

        const fila = await prisma.cuentaCorrienteOperacion.findUniqueOrThrow({ where: { id: OPERACION_RETENIDA_ID } });
        assert.equal(fila.estado, aprobar ? "APROBADA" : "RECHAZADA");
        assert.equal(fila.autorizado_por_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
        const cuenta = await prisma.cuentaCorrienteCliente.findUniqueOrThrow({ where: { id: CUENTA_CORRIENTE_JUAN_PEREZ_ID } });
        assert.equal(cuenta.saldo_actual.toNumber(), aprobar ? SALDO_SEED + 413000 : SALDO_SEED);

        // AuditLog materializado por el listener con el autorizacion_id devuelto por HTTP.
        let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
        for (let intento = 0; intento < 40 && filas.length === 0; intento++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          filas = (
            await prisma.auditLog.findMany({
              where: {
                tabla_afectada: "cuenta_corriente_operaciones",
                registro_id: OPERACION_RETENIDA_ID,
                accion: aprobar ? "EXCEPCION_CREDITO_APROBADA" : "EXCEPCION_CREDITO_RECHAZADA",
              },
            })
          ).filter((f) => (f.valor_nuevo as { autorizacion_id?: string } | null)?.autorizacion_id === body.data.autorizacion_id);
        }
        assert.equal(filas.length, 1);

        const repetido = await fetch(urlResolver(OPERACION_RETENIDA_ID), {
          method: "PATCH",
          headers: json(cookieSupervisor),
          body: JSON.stringify({ decision, motivo: "segundo intento" }),
        });
        const cuerpo = await repetido.json();
        assert.equal(repetido.status, 409, JSON.stringify(cuerpo));
        assert.deepEqual(cuerpo, {
          data: null,
          error: { code: "TRANSICION_INVALIDA", message: "Solo una operación en estado RETENIDA puede resolverse" },
        });
      });
    }

    await t.test("PATCH con supervisor sobre la operación retenida creada por el cajero → 200 (flujo completo alta 422 → resolución)", async () => {
      const res = await fetch(urlResolver(operacionRetenidaCajeroId), {
        method: "PATCH",
        headers: json(cookieSupervisor),
        body: JSON.stringify({ decision: "RECHAZAR", motivo: "excede política" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.estado, "RECHAZADA");
    });
  },
);
