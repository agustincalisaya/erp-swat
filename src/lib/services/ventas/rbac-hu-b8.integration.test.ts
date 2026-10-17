import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end de HU-B8 (roles operativos de Ventas):
 * task_HU-B8_roles_operativos_ventas.md Paso 3 pide un login REAL con
 * `cajero.seed`/`supervisor.ventas.seed` que pase `withPermission()` sobre
 * una ruta real protegida — no solo a nivel de servicio. Esto es justamente
 * lo que `presupuesto.service.test.ts` (HU-B3) dejó como "bloqueante
 * conocido" en su cabecera: esos tests solo hacen regex sobre el código
 * fuente porque, antes de HU-B8, un login real con esos usuarios recibía
 * 403 de todos modos (sin Rol asignado).
 *
 * Por qué HTTP real y no `import` directo del Route Handler: `withPermission`
 * usa `getServerSession()` → `cookies()` de `next/headers`, que depende del
 * AsyncLocalStorage que solo puebla el runtime real de Next al atender un
 * request — no se puede invocar `POST()` de un `route.ts` a mano fuera de
 * ese runtime y esperar que `cookies()` funcione. Por eso este test pega
 * contra un server real (`npm run dev` / `next start`), igual que un login
 * real de un usuario.
 *
 * Opt-in vía `HU_B8_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"),
 * `skip` si no está seteada — mismo patrón de integración opcional que
 * `test:integration:b3`/`test:integration:h4`.
 *
 * Cobertura real disponible en el código hoy: de las 10 rutas de Módulo B
 * descriptas en `spec_modulo_B.md`, SOLO existen las de HU-B3
 * (`POST /api/ventas/presupuestos`, gateada por `ventas:emitir_cotizacion`).
 * Las rutas de HU-B1 (`ventas:registrar_venta_mostrador`), HU-B4
 * (`ventas:autorizar_excepcion_descuento`), HU-B6
 * (`ventas:leer_log_operativo`) y HU-B7 §2.8 (`ventas:anular_pedido`) —que
 * el task file pide probar en su Paso 3— todavía no tienen Route Handler:
 * no son parte de esta tarea (que es "puramente de datos/roles", no crea
 * pantallas ni endpoints), así que esa parte de la verificación queda
 * documentada como bloqueada por la ausencia de esas rutas, no como una
 * regresión de HU-B8. Este archivo prueba end-to-end lo único que hoy tiene
 * una ruta real (`ventas:emitir_cotizacion`) y complementa los 9 permisos
 * restantes con `usuarioTienePermiso()` a nivel de servicio (mismo criterio
 * que `presupuesto.service.test.ts`).
 */

const BASE_URL = process.env.HU_B8_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";

const CLIENTE_JUAN_PEREZ_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000001";
const VARIANTE_CAMISA_TACTICA_2_ID = "6fbb4612-9e6d-4661-b250-0bc62579089e";
const DEPOSITO_SEED_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";

interface LoginResultado {
  cookie: string;
  roles: string[];
}

async function loginReal(email: string): Promise<LoginResultado> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login falló para ${email}: ${JSON.stringify(body)}`);

  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login para ${email} no devolvió cookie de sesión`);

  return { cookie: setCookie!.split(";")[0]!, roles: body.data.roles };
}

test(
  "HU-B8 — login real de cajero.seed/supervisor.ventas.seed contra rutas reales protegidas",
  { skip: !BASE_URL, timeout: 30_000 },
  async (t) => {
    // ── 1. Login real: el JWT/roles que devuelve /api/auth/login reflejan
    // la asignación de Rol hecha por el seed de HU-B8 ─────────────────────
    await t.test("cajero.seed loguea con rol CAJERO_POS asignado", async () => {
      const { roles } = await loginReal("cajero.seed@erp-swat.local");
      assert.deepEqual(roles, ["CAJERO_POS"]);
    });

    await t.test("supervisor.ventas.seed loguea con rol SUPERVISOR_VENTAS asignado", async () => {
      const { roles } = await loginReal("supervisor.ventas.seed@erp-swat.local");
      assert.deepEqual(roles, ["SUPERVISOR_VENTAS"]);
    });

    // ── 2. Controles negativos — la ruta protegida rechaza sin sesión y sin
    // el permiso correcto, para no confundir "siempre deja pasar" con "el
    // gate realmente funciona" ─────────────────────────────────────────────
    await t.test("POST /api/ventas/presupuestos sin sesión devuelve 401", async () => {
      const res = await fetch(`${BASE_URL}/api/ventas/presupuestos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 401);
    });

    await t.test("POST /api/ventas/presupuestos con sesión sin permiso ventas:* devuelve 403 (auditor.seed)", async () => {
      const { cookie } = await loginReal("auditor.seed@erp-swat.local");
      const res = await fetch(`${BASE_URL}/api/ventas/presupuestos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          cliente_id: CLIENTE_JUAN_PEREZ_ID,
          vigencia_dias: 5,
          items: [{ variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, deposito_id: DEPOSITO_SEED_ID, cantidad: 1, precio_cotizado: 100 }],
        }),
      });
      assert.equal(res.status, 403);
    });

    // ── 3. Caso positivo real: cajero.seed pasa withPermission("ventas:emitir_cotizacion")
    // sobre la ÚNICA ruta de Módulo B implementada hoy (HU-B3) ─────────────
    await t.test("POST /api/ventas/presupuestos con sesión real de cajero.seed pasa withPermission y crea el Presupuesto", async () => {
      const { cookie } = await loginReal("cajero.seed@erp-swat.local");
      const res = await fetch(`${BASE_URL}/api/ventas/presupuestos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          cliente_id: CLIENTE_JUAN_PEREZ_ID,
          vigencia_dias: 5,
          origen_reserva: "LICITACION",
          items: [{ variante_sku_id: VARIANTE_CAMISA_TACTICA_2_ID, deposito_id: DEPOSITO_SEED_ID, cantidad: 1, precio_cotizado: 9999 }],
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `esperaba 201 (no 403): ${JSON.stringify(body)}`);
      assert.equal(body.data.estado, "EMITIDO");
    });

    // ── 4. Resto de los permisos del mapeo de HU-B8 — sin ruta real
    // disponible para ejercitarlos por HTTP (ver nota de cabecera), se
    // verifican a nivel de servicio contra la base real (mismo criterio que
    // presupuesto.service.test.ts) ─────────────────────────────────────────
    const [{ usuarioTienePermiso }, { prisma }] = await Promise.all([
      import("../../auth/with-permission.ts"),
      import("../../db/prisma.ts"),
    ]);
    t.after(() => prisma.$disconnect());

    const permisosCajeroPos = [
      "ventas:registrar_venta_mostrador",
      "ventas:gestionar_turno_caja",
      "ventas:emitir_cotizacion",
      "ventas:aplicar_descuento_margen",
      "ventas:gestionar_cuenta_corriente",
      "ventas:leer",
    ];
    const permisosExclusivosSupervisor = [
      "ventas:autorizar_excepcion_descuento",
      "ventas:autorizar_excepcion_credito",
      "ventas:anular_pedido",
      "ventas:leer_log_operativo",
    ];

    await t.test("CAJERO_POS tiene exactamente los 6 permisos del mapeo confirmado, ni uno de los 4 exclusivos de Supervisor", async () => {
      for (const codigo of permisosCajeroPos) {
        assert.equal(await usuarioTienePermiso(USUARIO_CAJERO_SEED_ID, codigo), true, `cajero.seed debería tener ${codigo}`);
      }
      for (const codigo of permisosExclusivosSupervisor) {
        assert.equal(await usuarioTienePermiso(USUARIO_CAJERO_SEED_ID, codigo), false, `cajero.seed NO debería tener ${codigo}`);
      }
    });

    await t.test("SUPERVISOR_VENTAS tiene los 10 permisos ventas:* (los 6 de CAJERO_POS + los 4 exclusivos)", async () => {
      for (const codigo of [...permisosCajeroPos, ...permisosExclusivosSupervisor]) {
        assert.equal(
          await usuarioTienePermiso(USUARIO_SUPERVISOR_VENTAS_SEED_ID, codigo),
          true,
          `supervisor.ventas.seed debería tener ${codigo}`,
        );
      }
    });
  },
);
