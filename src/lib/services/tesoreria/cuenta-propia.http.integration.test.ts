import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-G5 (`/api/tesoreria/cuentas-propias/**`) —
 * mismo patrón que `baja-cliente.http.integration.test.ts`: el 401 real de
 * sesión y el 403 de RBAC solo se verifican contra un servidor real (el HOF
 * `withPermission()` depende de `cookies()` de `next/headers`).
 *
 * Matriz de autorización (spec §9.7/G5-3):
 *   - 401 sin sesión en todas las rutas.
 *   - Cajero POS → 403 en TODAS las rutas (no tiene ningún permiso de G5).
 *   - Auditor → GET 200 (leer), alta/edición/baja 403 (no gestionar), revelar
 *     403 (no ver_datos).
 *   - Tesorero → GET 200 y revelar 200 (con `Cache-Control: no-store`), alta 403.
 *   - Administrador → alta 201, edición 200, baja 200, revelar 200 no-store.
 *
 * Opt-in vía `HU_G5_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"). Si no
 * está seteada el archivo FALLA con un mensaje explícito (no `skip` silencioso:
 * un gate que no corre no puede reportar verde). Requiere un server ya buildeado
 * (`npm run build` + `npm start`).
 */

const BASE_URL = process.env.HU_G5_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

// Falla FUERTE (nunca `skip` silencioso) si falta la configuración del gate.
if (!BASE_URL) {
  test("HU-G5 HTTP — configuración faltante (gate no ejecutado)", () => {
    assert.fail(
      "Falta HU_G5_INTEGRATION_BASE_URL. Este gate NO se ejecuta con 'npm test'; " +
        "levantá el server ('npm run build' + 'npm start') y volvé a correr " +
        "'npm run test:integration:g5-http'.",
    );
  });
}

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
  "HU-G5 — /api/tesoreria/cuentas-propias contra un servidor real (401/403/201/200 + no-store)",
  { skip: !BASE_URL, timeout: 60_000 },
  async () => {
    const [admin, tesorero, auditor, cajero] = await Promise.all([
      loginReal("admin.seed@erp-swat.local"),
      loginReal("tesorero.seed@erp-swat.local"),
      loginReal("auditor.seed@erp-swat.local"),
      loginReal("cajero.seed@erp-swat.local"),
    ]);

    const raiz = `${BASE_URL}/api/tesoreria/cuentas-propias`;
    const conCookie = (cookie?: string, init?: RequestInit): RequestInit => ({
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    // ── 401 sin sesión ───────────────────────────────────────────────────────
    assert.equal((await fetch(raiz)).status, 401);
    assert.equal((await fetch(raiz, { method: "POST" })).status, 401);

    // ── Cajero POS: 403 en la ruta raíz para GET y POST ─────────────────────
    assert.equal((await fetch(raiz, conCookie(cajero))).status, 403);
    assert.equal((await fetch(raiz, conCookie(cajero, { method: "POST" }))).status, 403);

    // ── Auditor: lectura OK, gestión/revelado 403 ────────────────────────────
    const getAuditor = await fetch(raiz, conCookie(auditor));
    assert.equal(getAuditor.status, 200);

    // ── Alta con Administrador (201) ─────────────────────────────────────────
    const sufijo = Date.now().toString(36);
    const alta = await fetch(
      raiz,
      conCookie(admin, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: `Cuenta HTTP ${sufijo}`,
          tipo: "BANCARIA",
          banco: "Banco HTTP",
          cbu: "0110599520000001234567",
          alias: `http.${sufijo}`,
        }),
      }),
    );
    const altaBody = await alta.json();
    assert.equal(alta.status, 201, `alta falló: ${JSON.stringify(altaBody)}`);
    const cuentaId: string = altaBody.data.cuenta_propia_id;
    assert.ok(cuentaId);

    const rutaCuenta = `${raiz}/${cuentaId}`;

    // ── Tesorero: GET 200 pero alta/edición 403 (no gestionar) ───────────────
    assert.equal((await fetch(raiz, conCookie(tesorero))).status, 200);
    assert.equal(
      (
        await fetch(
          raiz,
          conCookie(tesorero, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre: "X", tipo: "CAJA" }),
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (await fetch(rutaCuenta, conCookie(tesorero, { method: "PATCH" }))).status,
      403,
    );
    assert.equal(
      (await fetch(`${rutaCuenta}/baja`, conCookie(tesorero, { method: "POST" }))).status,
      403,
    );

    // ── Cajero POS: 403 en las rutas por id ──────────────────────────────────
    assert.equal((await fetch(rutaCuenta, conCookie(cajero, { method: "PATCH" }))).status, 403);
    assert.equal(
      (await fetch(`${rutaCuenta}/baja`, conCookie(cajero, { method: "POST" }))).status,
      403,
    );
    assert.equal(
      (await fetch(`${rutaCuenta}/revelar`, conCookie(cajero, { method: "POST" }))).status,
      403,
    );

    // ── Auditor sin ver_datos_bancarios: revelar 403 ─────────────────────────
    assert.equal(
      (await fetch(`${rutaCuenta}/revelar`, conCookie(auditor, { method: "POST" }))).status,
      403,
    );

    // ── Edición con Administrador (200) ──────────────────────────────────────
    const patch = await fetch(
      rutaCuenta,
      conCookie(admin, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: `Cuenta HTTP renombrada ${sufijo}` }),
      }),
    );
    const patchBody = await patch.text();
    assert.equal(patch.status, 200, `edición falló: ${patchBody}`);

    // ── Revelado: Tesorero 200 con Cache-Control: no-store ───────────────────
    const revelarTesorero = await fetch(
      `${rutaCuenta}/revelar`,
      conCookie(tesorero, { method: "POST" }),
    );
    // Leer el cuerpo UNA sola vez: usarlo en el mensaje del assert y en el parseo.
    const revelarBody = await revelarTesorero.text();
    assert.equal(revelarTesorero.status, 200, `revelar falló: ${revelarBody}`);
    assert.equal(revelarTesorero.headers.get("cache-control"), "no-store");
    const revelado = JSON.parse(revelarBody) as { data: { cbu: string } };
    assert.equal(revelado.data.cbu, "0110599520000001234567");

    // ── Baja con Administrador (200) ─────────────────────────────────────────
    const baja = await fetch(
      `${rutaCuenta}/baja`,
      conCookie(admin, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletion_reason: "Baja de prueba HTTP" }),
      }),
    );
    const bajaBody = await baja.text();
    assert.equal(baja.status, 200, `baja falló: ${bajaBody}`);
    const bajaJson = JSON.parse(bajaBody) as { data: { is_active: boolean } };
    assert.equal(bajaJson.data.is_active, false);
  },
);
