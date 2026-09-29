import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end de HU-E10 (roles ADMINISTRADOR_ECOMMERCE /
 * OPERADOR_PICK_PACK) — docs/tasks/HU-E10.md §8, Nivel 2, casos 1 a 8.
 * Mismo patrón que `rbac-hu-b8.integration.test.ts`: login HTTP real contra
 * un server de Next levantado (`withPermission`/`withAuth` dependen de
 * `cookies()`, que solo existe dentro del runtime real) + `usuarioTienePermiso()`
 * a nivel de servicio contra la base real.
 *
 * Opt-in vía `HU_E10_INTEGRATION_BASE_URL` (ej. "http://localhost:3000"),
 * `skip` si no está seteada.
 *
 * Cobertura HTTP positiva: ninguna. Todavía no existe ninguna ruta
 * `app/api/ecommerce/**` (HU-E4/E5/E7/E11/E12/E13/E6, fuera de esta HU), así
 * que la matriz se verifica con `usuarioTienePermiso()` (caso 3) y el gate HTTP
 * solo por el lado negativo, contra una ruta real de otro módulo (casos 5-6).
 *
 * El caso 9 (idempotencia del seed) NO está acá a propósito: correr el seed
 * desde un test es peligroso si alguien lo apunta a una base compartida. Se
 * corre a mano, solo en BD local descartable (ver HU10_MODULO_E.md).
 */

const BASE_URL = process.env.HU_E10_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";
const USUARIO_OPERADOR_PICK_PACK_SEED_ID = "62fd609c-ea3b-4e62-b9d2-5ccffad13849";

/** Matriz de spec_modulo_E.md §2.10: [código, Administrador E-commerce, Operador de Pick & Pack]. */
const MATRIZ_ECOMMERCE: Array<[string, boolean, boolean]> = [
  ["ecommerce:gestionar_catalogo", true, false],
  ["ecommerce:gestionar_cupones", true, false],
  ["ecommerce:anular_orden_no_abonada", true, false],
  ["ecommerce:cancelar_pedido_pagado", true, false],
  ["ecommerce:leer_cola_preparacion", true, true],
  ["ecommerce:preparar_pedido", false, true],
  ["ecommerce:validar_retiro_qr", false, true],
  ["ecommerce:leer_historial_ordenes", true, false],
  ["ecommerce:exportar_metricas", true, false],
  ["ecommerce:solicitar_acceso_log_pagos", true, false],
];

const PERMISOS_AJENOS = ["auditoria:leer_forense", "ventas:leer", "roles:administrar"];

async function login(email: string, password: string) {
  return fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

async function loginReal(email: string): Promise<{ cookie: string; roles: string[] }> {
  const res = await login(email, PASSWORD_SEED);
  const body = await res.json();
  assert.equal(res.status, 200, `login falló para ${email}: ${JSON.stringify(body)}`);

  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie?.startsWith("swat_session="), `login para ${email} no devolvió la cookie swat_session`);

  return { cookie: setCookie!.split(";")[0]!, roles: body.data.roles };
}

test(
  "HU-E10 — login real de admin.ecommerce.seed/operador.pickpack.seed y matriz efectiva de permisos ecommerce:*",
  { skip: !BASE_URL, timeout: 30_000 },
  async (t) => {
    // ── Casos 1-2: login real, cookie swat_session y rol asignado por el seed ──
    await t.test("1. admin.ecommerce.seed loguea (200 + swat_session) con rol ADMINISTRADOR_ECOMMERCE", async () => {
      const { roles } = await loginReal("admin.ecommerce.seed@erp-swat.local");
      assert.deepEqual(roles, ["ADMINISTRADOR_ECOMMERCE"]);
    });

    await t.test("2. operador.pickpack.seed loguea (200 + swat_session) con rol OPERADOR_PICK_PACK", async () => {
      const { roles } = await loginReal("operador.pickpack.seed@erp-swat.local");
      assert.deepEqual(roles, ["OPERADOR_PICK_PACK"]);
    });

    // ── Casos 5-6: negativo HTTP contra una ruta real de otro módulo ─────────
    await t.test("5. GET /api/ventas/auditoria con sesión de operador.pickpack.seed devuelve 403", async () => {
      const { cookie } = await loginReal("operador.pickpack.seed@erp-swat.local");
      const res = await fetch(`${BASE_URL}/api/ventas/auditoria`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 403);
    });

    await t.test("6. GET /api/ventas/auditoria con sesión de admin.ecommerce.seed devuelve 403", async () => {
      const { cookie } = await loginReal("admin.ecommerce.seed@erp-swat.local");
      const res = await fetch(`${BASE_URL}/api/ventas/auditoria`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 403);
    });

    // ── Casos 7-8: identidades que NO son usuarios del RBAC interno ──────────
    await t.test("7. el Cliente Web (juan.perez@example.com) no puede loguear en el ERP: 401", async () => {
      const res = await login("juan.perez@example.com", PASSWORD_SEED);
      assert.equal(res.status, 401);
    });

    await t.test("8. el usuario de sistema canal.web.sistema no puede loguear: 401", async () => {
      const res = await login("canal.web.sistema@erp-swat.local", PASSWORD_SEED);
      assert.equal(res.status, 401);
    });

    // ── Casos 3-4: matriz efectiva a nivel de servicio, contra la base real ──
    const [{ usuarioTienePermiso }, { prisma }] = await Promise.all([
      import("../../auth/with-permission.ts"),
      import("../../db/prisma.ts"),
    ]);
    t.after(() => prisma.$disconnect());

    await t.test("3. matriz efectiva: 10 permisos × 2 usuarios = spec_modulo_E.md §2.10", async () => {
      let aserciones = 0;
      for (const [codigo, admin, operador] of MATRIZ_ECOMMERCE) {
        assert.equal(
          await usuarioTienePermiso(USUARIO_ADMIN_ECOMMERCE_SEED_ID, codigo),
          admin,
          `admin.ecommerce.seed ${admin ? "debería" : "NO debería"} tener ${codigo}`,
        );
        assert.equal(
          await usuarioTienePermiso(USUARIO_OPERADOR_PICK_PACK_SEED_ID, codigo),
          operador,
          `operador.pickpack.seed ${operador ? "debería" : "NO debería"} tener ${codigo}`,
        );
        aserciones += 2;
      }
      assert.equal(aserciones, 20);
    });

    await t.test("4. ninguno de los dos usuarios tiene permisos ajenos (auditoria:leer_forense, ventas:leer, roles:administrar)", async () => {
      for (const usuarioId of [USUARIO_ADMIN_ECOMMERCE_SEED_ID, USUARIO_OPERADOR_PICK_PACK_SEED_ID]) {
        for (const codigo of PERMISOS_AJENOS) {
          assert.equal(await usuarioTienePermiso(usuarioId, codigo), false, `${usuarioId} NO debería tener ${codigo}`);
        }
      }
    });
  },
);
