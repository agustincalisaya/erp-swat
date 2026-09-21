import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-C6 (`PATCH /api/clientes/[id]/baja`) —
 * mismo patrón y mismo motivo que `segmento-cliente.http.integration.test.ts`:
 * `withPermission()` depende de `cookies()` de `next/headers`, así que el
 * 401/403 de sesión real y el mapeo de status del Route Handler solo se
 * verifican contra un servidor real (`npm start`).
 *
 * Verifica:
 *   - 401 sin sesión.
 *   - 403 con `vendedor.seed` (rol VENDEDOR: NO tiene `clientes:baja`, el
 *     acceso queda cerrado solo por RBAC — no existe flujo de solicitud).
 *   - 400 con motivo ausente/vacío (con `administrador.seed`, rol
 *     ADMINISTRADOR_CRM asignado por el seed de HU-C6).
 *   - 200 con `administrador.seed` y el shape `{ cliente_id, is_active: false }`.
 *   - 404 CLIENTE_NO_ENCONTRADO en la doble baja y con un id inexistente.
 *
 * Opt-in vía `HU_C6_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"), `skip`
 * si no está seteada. Requiere un server ya buildeado (`npm run build` +
 * `npm start`) para no comerse el presupuesto de 30s en cold-compile.
 *
 * El cliente fixture se crea por HTTP (`POST /api/clientes`) y queda dado de
 * baja al terminar el test — nunca se borra físicamente.
 */

const BASE_URL = process.env.HU_C6_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

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
  "HU-C6 — PATCH /api/clientes/[id]/baja contra un servidor real (401/403/400/200/404)",
  { skip: !BASE_URL, timeout: 30_000 },
  async (t) => {
    const cookieAdmin = await loginReal("admin.seed@erp-swat.local");
    const cookieVendedor = await loginReal("vendedor.seed@erp-swat.local");

    const dni = String(10_000_000 + (Date.now() % 89_999_999)).slice(0, 8);
    const alta = await fetch(`${BASE_URL}/api/clientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieAdmin },
      body: JSON.stringify({ dni, nombre: "Cliente HU-C6 HTTP" }),
    });
    const altaBody = await alta.json();
    assert.ok([200, 201].includes(alta.status), `alta fixture falló: ${JSON.stringify(altaBody)}`);
    const clienteId: string = altaBody.data.cliente_id;

    const baja = (id: string, body: unknown, cookie?: string) =>
      fetch(`${BASE_URL}/api/clientes/${id}/baja`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      });

    await t.test("sin sesión devuelve 401 UNAUTHORIZED", async () => {
      const res = await baja(clienteId, { deletion_reason: "x" });
      const body = await res.json();
      assert.equal(res.status, 401, JSON.stringify(body));
      assert.equal(body.error.code, "UNAUTHORIZED");
    });

    await t.test("Vendedor (sin clientes:baja) devuelve 403 FORBIDDEN y NO da de baja", async () => {
      const res = await baja(clienteId, { deletion_reason: "Intento de vendedor" }, cookieVendedor);
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(body.error.code, "FORBIDDEN");
    });

    await t.test("motivo ausente o vacío devuelve 400 VALIDATION_ERROR", async () => {
      for (const payload of [{}, { deletion_reason: "" }]) {
        const res = await baja(clienteId, payload, cookieAdmin);
        const body = await res.json();
        assert.equal(res.status, 400, `${JSON.stringify(payload)}: ${JSON.stringify(body)}`);
        assert.equal(body.error.code, "VALIDATION_ERROR");
        assert.ok(body.error.fieldErrors.deletion_reason?.length > 0);
      }
    });

    await t.test("Administrador CRM da de baja con motivo: 200 y shape exacto", async () => {
      const res = await baja(clienteId, { deletion_reason: "Baja de prueba HTTP HU-C6" }, cookieAdmin);
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.error, null);
      assert.deepEqual(body.data, { cliente_id: clienteId, is_active: false });
    });

    await t.test("doble baja devuelve 404 CLIENTE_NO_ENCONTRADO", async () => {
      const res = await baja(clienteId, { deletion_reason: "Segunda baja" }, cookieAdmin);
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "CLIENTE_NO_ENCONTRADO");
    });

    await t.test("id inexistente devuelve 404 CLIENTE_NO_ENCONTRADO", async () => {
      const res = await baja("00000000-0000-4000-8000-000000000000", { deletion_reason: "x" }, cookieAdmin);
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "CLIENTE_NO_ENCONTRADO");
    });

    await t.test("la ficha del cliente dado de baja sigue consultable por DNI con is_active:false", async () => {
      const res = await fetch(`${BASE_URL}/api/clientes/buscar?dni=${dni}`, {
        headers: { Cookie: cookieAdmin },
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.is_active, false);
      assert.equal(body.data.cliente_id, clienteId);
    });
  },
);
