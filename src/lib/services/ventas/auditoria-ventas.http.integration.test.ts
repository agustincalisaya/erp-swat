import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-B6 (Nivel 2 del task file) — mismo
 * patrón y motivo que `cuenta-corriente.http.integration.test.ts`: el gate
 * depende de `cookies()` de `next/headers`, así que 401/403 de sesión real
 * solo se prueban contra un servidor real (`npm run dev` / `next start`).
 *
 * Login real con `auditor.seed` / `supervisor.ventas.seed` / `cajero.seed`
 * contra `GET /api/ventas/auditoria`:
 *  - sin sesión → 401 · cajero → 403 FORBIDDEN (aun con query inválido: el gate va primero).
 *  - auditor → 200, shape `{ registros, total, page, page_size }`, total = TODOS los
 *    eventos de Módulo B (oráculo: conteo directo en la base).
 *  - supervisor → 200 solo con eventos donde es autorizante o solicitante
 *    (oráculo: filtro en JS sobre TODOS los eventos de Módulo B leídos de la base).
 *  - `verificar_integridad=true` con supervisor → 403 VERIFICACION_INTEGRIDAD_NO_DISPONIBLE;
 *    `=false` explícito con supervisor → 200 (regresión de `z.coerce.boolean()`);
 *    `=0`/`=1` → 400; con auditor → 200 con `verificacion_integridad.integra` calculado.
 *
 * Solo lectura sobre la base (los logins sí agregan eventos de sesión, ajenos
 * al dominio de Módulo B). Requiere que existan eventos de Módulo B en
 * `audit_logs`: `npm run test:integration:b6` (o b4/b5) los genera.
 *
 * Opt-in: `HU_B6_INTEGRATION_BASE_URL` (ej. "http://localhost:3000") +
 * `HU_B6_INTEGRATION_DATABASE_URL` (misma base a la que apunta el servidor);
 * `skip` si falta alguna. Corre con `npm run test:integration:b6-http`.
 */

const BASE_URL = process.env.HU_B6_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_B6_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";

const ACCIONES_MODULO_B = [
  "DESCUENTO_FUERA_MARGEN",
  "CAMBIO_PRECIO_MANUAL",
  "EXCEPCION_CREDITO_APROBADA",
  "EXCEPCION_CREDITO_RECHAZADA",
];

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

type Registro = {
  id: string;
  usuario_id: string | null;
  accion: string;
  registro_id: string | null;
  valor_anterior: unknown;
  valor_nuevo: unknown;
};

test(
  "HU-B6 — GET /api/ventas/auditoria contra un servidor real (401/403/200/400, alcance por rol, integridad)",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const { prisma } = await import("../../db/prisma.ts");
    t.after(async () => prisma.$disconnect());

    const cookieAuditor = await loginReal("auditor.seed@erp-swat.local");
    const cookieSupervisor = await loginReal("supervisor.ventas.seed@erp-swat.local");
    const cookieCajero = await loginReal("cajero.seed@erp-swat.local");

    const get = (query: string, cookie?: string) =>
      fetch(`${BASE_URL}/api/ventas/auditoria${query}`, { headers: cookie ? { Cookie: cookie } : {} });

    // Oráculo independiente: TODOS los eventos de Módulo B, leídos directo de la base.
    const todos = await prisma.auditLog.findMany({
      where: { accion: { in: ACCIONES_MODULO_B } },
      select: { id: true, usuario_id: true, accion: true, registro_id: true, valor_nuevo: true },
      orderBy: { created_at: "desc" },
    });
    assert.ok(todos.length >= 3, "faltan eventos de Módulo B: correr npm run test:integration:b6 antes");
    const solicitanteDe = (v: unknown) => (v as { usuario_solicitante_id?: string } | null)?.usuario_solicitante_id;
    const delSupervisor = todos.filter(
      (e) => e.usuario_id === USUARIO_SUPERVISOR_VENTAS_SEED_ID || solicitanteDe(e.valor_nuevo) === USUARIO_SUPERVISOR_VENTAS_SEED_ID,
    );
    assert.ok(delSupervisor.length >= 1);

    // ── Gate ────────────────────────────────────────────────────────────────
    await t.test("sin sesión → 401 UNAUTHORIZED", async () => {
      const res = await get("");
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error.code, "UNAUTHORIZED");
    });

    await t.test("cajero.seed → 403 FORBIDDEN (también con query inválido: el gate va antes que la validación)", async () => {
      for (const q of ["", "?page_size=999&verificar_integridad=0"]) {
        const res = await get(q, cookieCajero);
        assert.equal(res.status, 403, q);
        const body = await res.json();
        assert.equal(body.data, null);
        assert.equal(body.error.code, "FORBIDDEN");
      }
    });

    // ── Auditor ─────────────────────────────────────────────────────────────
    await t.test("auditor.seed → 200 con shape { registros, total, page, page_size }, ve eventos de TODOS los usuarios", async () => {
      const res = await get("?page_size=50", cookieAuditor);
      assert.equal(res.status, 200);
      const { data, error } = await res.json();
      assert.equal(error, null);
      assert.equal(data.total, todos.length);
      assert.equal(data.page, 1);
      assert.equal(data.page_size, 50);
      assert.equal(data.verificacion_integridad, undefined);
      const registros = data.registros as Registro[];
      assert.equal(registros.length, Math.min(50, todos.length));
      for (const r of registros) assert.ok(ACCIONES_MODULO_B.includes(r.accion), r.accion);
    });

    await t.test("auditor: tipo_evento y pedido_venta_id devuelven exactamente lo que dice el oráculo", async () => {
      const desc = await (await get("?tipo_evento=venta:descuento_fuera_margen&page_size=50", cookieAuditor)).json();
      assert.equal(desc.data.total, todos.filter((e) => e.accion === "DESCUENTO_FUERA_MARGEN").length);

      const cred = await (await get("?tipo_evento=venta:excepcion_credito_resuelta&page_size=50", cookieAuditor)).json();
      assert.equal(cred.data.total, todos.filter((e) => e.accion.startsWith("EXCEPCION_CREDITO_")).length);

      // Un pedido con evento de crédito: se encuentra por el path JSON `valor_nuevo.pedido_venta_id`.
      const eventoCredito = todos.find((e) => e.accion.startsWith("EXCEPCION_CREDITO_"))!;
      const pedidoId = (eventoCredito.valor_nuevo as { pedido_venta_id: string }).pedido_venta_id;
      const esperados = todos.filter(
        (e) => e.registro_id === pedidoId || (e.valor_nuevo as { pedido_venta_id?: string } | null)?.pedido_venta_id === pedidoId,
      );
      const porPedido = await (await get(`?pedido_venta_id=${pedidoId}&page_size=50`, cookieAuditor)).json();
      assert.equal(porPedido.data.total, esperados.length);
      assert.ok((porPedido.data.registros as Registro[]).some((r) => r.registro_id === eventoCredito.registro_id));
    });

    await t.test("auditor + verificar_integridad=true → 200 con verificacion_integridad.integra calculado", async () => {
      const res = await get("?verificar_integridad=true", cookieAuditor);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.equal(typeof data.verificacion_integridad.integra, "boolean");
      assert.equal(typeof data.verificacion_integridad.registros_verificados, "number");
    });

    // ── Supervisor ──────────────────────────────────────────────────────────
    await t.test("supervisor.ventas.seed → 200 SOLO con eventos donde es autorizante o solicitante (oráculo en JS)", async () => {
      const res = await get("?page_size=50", cookieSupervisor);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.equal(data.total, delSupervisor.length);
      const ids = new Set((data.registros as Registro[]).map((r) => r.id));
      assert.deepEqual(
        [...ids].sort(),
        delSupervisor.slice(0, 50).map((e) => e.id).sort(),
      );
      // Decisión 8: el detalle (valor_anterior/valor_nuevo) viaja también al Supervisor.
      for (const r of data.registros as Registro[]) assert.notEqual(r.valor_nuevo, null, r.accion);
    });

    await t.test("supervisor + verificar_integridad=true → 403 VERIFICACION_INTEGRIDAD_NO_DISPONIBLE (mensaje exacto)", async () => {
      const res = await get("?verificar_integridad=true", cookieSupervisor);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), {
        data: null,
        error: {
          code: "VERIFICACION_INTEGRIDAD_NO_DISPONIBLE",
          message: "La verificación de integridad de la cadena SHA-256 está reservada al rol Auditor",
        },
      });
    });

    await t.test("supervisor + verificar_integridad=false EXPLÍCITO → 200 (no 403: regresión de z.coerce.boolean)", async () => {
      const res = await get("?verificar_integridad=false", cookieSupervisor);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.equal(data.verificacion_integridad, undefined);
    });

    // ── Validación ──────────────────────────────────────────────────────────
    await t.test("400 VALIDATION_ERROR: verificar_integridad=0/1, page_size>50, tipo_evento y uuid inválidos", async () => {
      for (const q of [
        "?verificar_integridad=0",
        "?verificar_integridad=1",
        "?page_size=51",
        "?page=0",
        "?tipo_evento=venta:turno_abierto",
        "?pedido_venta_id=no-es-uuid",
        "?usuario_id=no-es-uuid",
      ]) {
        const res = await get(q, cookieAuditor);
        assert.equal(res.status, 400, q);
        const body = await res.json();
        assert.equal(body.error.code, "VALIDATION_ERROR", q);
      }
    });
  },
);
