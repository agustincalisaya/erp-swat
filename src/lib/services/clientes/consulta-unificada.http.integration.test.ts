import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-C7 (`GET /api/clientes/buscar?dni=`) —
 * mismo patrón y mismo motivo que
 * `segmento-cliente.http.integration.test.ts`: `withPermission()`/`withAuth()`
 * dependen de `cookies()` de `next/headers` (AsyncLocalStorage poblado solo por
 * el runtime real de Next al atender un request), así que un 401/403 de sesión
 * real y el mapeo de status HTTP del Route Handler solo se pueden verificar
 * pegando contra un servidor real (`npm start`), no invocando el `route.ts` a
 * mano.
 *
 * `consulta-unificada.integration.test.ts` (nivel de servicio) ya cubre el
 * contrato contra Postgres real (ficha, direcciones, historial, clúster de
 * fusión, validación del DNI, no-escritura). Este archivo agrega SOLO lo que
 * necesita sesión HTTP real:
 *   - 401 sin sesión y 403 con una sesión real sin el permiso
 *     (`cajero.seed` = rol CAJERO_POS, sin ningún `clientes:*`).
 *   - 200 con `vendedor.seed` (rol VENDEDOR, con `clientes:leer`) y el shape
 *     exacto de §2.7; y 200 con `auditor.seed` (AUDITOR **sí** tiene
 *     `clientes:leer`, a diferencia de HU-C8 donde da 403).
 *   - el mapeo de status del Route Handler (200/400/404).
 *
 * `vendedor.seed` es el usuario del seed con el rol VENDEDOR, es decir con
 * `clientes:leer`: sin él no existe camino feliz HTTP.
 *
 * Opt-in vía `HU_C7_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"),
 * `skip` si no está seteada.
 *
 * Requisito operativo del server base — PITFALL DE COLD-COMPILE: si es un
 * `npm run dev`, compila cada ruta en su PRIMER request. Sobre un dev server
 * frío esa compilación puede comerse el presupuesto de 30s de esta suite. Por
 * eso hay que correr contra un `next start` ya buildeado (`npm run build` +
 * `npm start`) o "calentar" las rutas antes de correrla. NO se sube el timeout
 * de 30s para compensar: con las rutas compiladas la suite corre en pocos
 * segundos.
 *
 * Alcance explícito: esta suite es de SOLO LECTURA — no crea ni baja
 * fixtures. El estado que verifica (Juan Pérez con 2 direcciones y 2 compras
 * efectivas) proviene del seed.
 */

const BASE_URL = process.env.HU_C7_INTEGRATION_BASE_URL;
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
  "HU-C7 — GET /api/clientes/buscar contra un servidor real (401/403/400/404/200)",
  { skip: !BASE_URL, timeout: 30_000 },
  async (t) => {
    const url = (dni: string) => `${BASE_URL}/api/clientes/buscar?dni=${encodeURIComponent(dni)}`;

    // ── 1. Sin sesión: 401 ─────────────────────────────────────────────────
    await t.test("GET sin sesión devuelve 401 UNAUTHORIZED", async () => {
      const res = await fetch(url("30123456"));
      const body = await res.json();
      assert.equal(res.status, 401, JSON.stringify(body));
      assert.equal(body.error.code, "UNAUTHORIZED");
    });

    // ── 2. cajero.seed: rol CAJERO_POS, sin ningún clientes:* → 403 ────────
    await t.test("GET con sesión de cajero.seed (sin clientes:*) devuelve 403 FORBIDDEN", async () => {
      const cookie = await loginReal("cajero.seed@erp-swat.local");
      const res = await fetch(url("30123456"), { headers: { Cookie: cookie } });
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(body.error.code, "FORBIDDEN");
    });

    // ── 3. vendedor.seed: rol VENDEDOR con clientes:leer → 200 ─────────────
    const cookieVendedor = await loginReal("vendedor.seed@erp-swat.local");

    await t.test("GET con vendedor.seed devuelve 200 y el shape exacto de §2.7", async () => {
      const res = await fetch(url("30123456"), { headers: { Cookie: cookieVendedor } });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.error, null);

      const data = body.data;
      assert.deepEqual(
        Object.keys(data).sort(),
        [
          "canal_preferido",
          "cliente_id",
          "direcciones",
          "dni",
          "email",
          "historial_compras",
          "is_active",
          "nombre",
          "telefono",
        ],
        "el payload expone is_active (HU-C6) pero NO segmento, deleted_* ni fusionado_en_id",
      );
      assert.equal(data.dni, "30123456");
      assert.equal(data.nombre, "Juan Pérez");
      assert.equal(data.canal_preferido, "WHATSAPP");
      assert.equal(data.is_active, true);

      assert.equal(data.direcciones.length, 2);
      for (const direccion of data.direcciones) {
        assert.deepEqual(
          Object.keys(direccion).sort(),
          ["direccion_id", "rotulo", "tipo"],
          "cada dirección expone SOLO direccion_id, rotulo y tipo",
        );
        assert.equal(typeof direccion.direccion_id, "string");
        assert.ok(direccion.direccion_id.length > 0);
      }

      assert.equal(data.historial_compras.monto_total_historico, 458000);
      assert.equal(data.historial_compras.cantidad_operaciones, 2);
      assert.ok(
        typeof data.historial_compras.ultima_compra === "string",
        "ultima_compra se serializa como string ISO",
      );
    });

    // ── 4. auditor.seed: AUDITOR SÍ tiene clientes:leer → 200 (≠ HU-C8) ────
    await t.test("GET con auditor.seed devuelve 200 (AUDITOR tiene clientes:leer)", async () => {
      const cookie = await loginReal("auditor.seed@erp-swat.local");
      const res = await fetch(url("30123456"), { headers: { Cookie: cookie } });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.error, null);
    });

    // ── 5. Validación: 400 VALIDATION_ERROR ────────────────────────────────
    await t.test("DNI con formato inválido devuelve 400 VALIDATION_ERROR con fieldErrors.dni", async () => {
      for (const dni of ["abc", "123", "123456789", ""]) {
        const res = await fetch(url(dni), { headers: { Cookie: cookieVendedor } });
        const body = await res.json();
        assert.equal(res.status, 400, `dni=${JSON.stringify(dni)}: ${JSON.stringify(body)}`);
        assert.equal(body.error.code, "VALIDATION_ERROR");
        assert.deepEqual(body.error.fieldErrors.dni, ["El DNI debe tener 7 u 8 dígitos"]);
      }
    });

    // ── 6. Resolución del cliente: 404 ─────────────────────────────────────
    await t.test("DNI válido sin cliente activo devuelve 404 CLIENTE_NO_ENCONTRADO con el DNI en el mensaje", async () => {
      const res = await fetch(url("99999999"), { headers: { Cookie: cookieVendedor } });
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "CLIENTE_NO_ENCONTRADO");
      assert.match(body.error.message, /99999999/);
    });
  },
);
