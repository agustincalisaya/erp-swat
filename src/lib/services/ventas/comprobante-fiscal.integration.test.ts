import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-B7 (task_relos.md §6) — mismo patrón y
 * motivo que `cuenta-corriente.http.integration.test.ts` /
 * `pedido-venta.http.integration.test.ts`: `withPermission()` depende de
 * `cookies()` de `next/headers`, así que 401/403 de sesión real solo se
 * prueban contra un servidor real (`npm run dev` / `next start`), no
 * invocando el `route.ts` a mano.
 *
 * Un único archivo de integración cubre este endpoint (a diferencia de
 * B4/B5, que separan `.integration.test.ts` de `.integration.http.test.ts`)
 * porque el ÚNICO caso de negocio real (404) y el gate de permiso (403) son
 * indisociables acá: no hay ninguna regla adicional en `obtenerComprobantePorId()`
 * que amerite un segundo archivo llamando al servicio directo contra
 * Postgres sin pasar por HTTP — decisión de alcance documentada en
 * `docs/tasks/task_relos.md` (ambigüedad resuelta explícitamente, no inferida
 * en silencio).
 *
 * Login real con `cajero.seed` (tiene `ventas:leer`) / `comprador.seed`
 * (rol de Módulo H, sin ningún permiso de Ventas — HU-B7 §1 confirma que
 * TODOS los roles del módulo Ventas lo tienen, así que el caso "sin permiso"
 * necesita un usuario de OTRO módulo):
 *  - GET comprobante existente (fixture de seed) → 200, shape completo.
 *  - GET id inexistente (UUID válido, sin fila) → 404 COMPROBANTE_NO_ENCONTRADO.
 *  - GET sin sesión → 401.
 *  - GET con comprador.seed (sin ventas:leer) → 403.
 *  - GET con id mal formado → 400.
 *
 * Opt-in: `HU_B7_INTEGRATION_BASE_URL` (ej. "http://localhost:3100") +
 * `HU_B7_INTEGRATION_DATABASE_URL` (misma base a la que apunta el servidor);
 * `skip` si falta alguna. Corre con `npm run test:integration:b7`.
 */

const BASE_URL = process.env.HU_B7_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_B7_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";

const COMPROBANTE_FISCAL_MOSTRADOR_ID = "1a2b3c4d-be05-4a1a-8a1a-000000000001";
const PEDIDO_VENTA_MOSTRADOR_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000001";
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
  "HU-B7 — GET /api/ventas/comprobantes/[id] contra un servidor real (200/404/401/403/400)",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 60_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const { prisma } = await import("../../db/prisma.ts");
    t.after(async () => {
      await prisma.$disconnect();
    });

    const cookieCajero = await loginReal("cajero.seed@erp-swat.local");
    const cookieComprador = await loginReal("comprador.seed@erp-swat.local");
    const json = (cookie?: string) => ({
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    });
    const url = (id: string) => `${BASE_URL}/api/ventas/comprobantes/${id}`;

    await t.test("sin sesión → 401", async () => {
      const res = await fetch(url(COMPROBANTE_FISCAL_MOSTRADOR_ID));
      assert.equal(res.status, 401);
    });

    await t.test("con comprador.seed (sin ventas:leer) → 403", async () => {
      const res = await fetch(url(COMPROBANTE_FISCAL_MOSTRADOR_ID), { headers: json(cookieComprador) });
      assert.equal(res.status, 403);
    });

    await t.test("id mal formado → 400 VALIDATION_ERROR", async () => {
      const res = await fetch(url("no-es-uuid"), { headers: json(cookieCajero) });
      const body = await res.json();
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(body.data, null);
      assert.equal(body.error.code, "VALIDATION_ERROR");
    });

    await t.test("id inexistente (UUID válido) → 404 COMPROBANTE_NO_ENCONTRADO", async () => {
      const res = await fetch(url(UUID_INEXISTENTE), { headers: json(cookieCajero) });
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.deepEqual(body, {
        data: null,
        error: { code: "COMPROBANTE_NO_ENCONTRADO", message: "No se encontró el comprobante solicitado" },
      });
    });

    await t.test("comprobante existente (fixture de seed) → 200 con el shape completo de spec §4", async () => {
      const res = await fetch(url(COMPROBANTE_FISCAL_MOSTRADOR_ID), { headers: json(cookieCajero) });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.error, null);
      assert.equal(body.data.comprobante_id, COMPROBANTE_FISCAL_MOSTRADOR_ID);
      assert.equal(body.data.pedido_venta_id, PEDIDO_VENTA_MOSTRADOR_ID);
      assert.equal(body.data.tipo_comprobante, "FACTURA_B");
      assert.equal(body.data.cae_simulado, "68031598274563");
      assert.match(body.data.qr_data_url, /^data:image\/png;base64,/);
      assert.equal(body.data.es_simulado, true);
      assert.equal(body.data.monto_total, 45000);

      // Confirma contra la BD, sin depender únicamente de lo que devuelve HTTP.
      const fila = await prisma.comprobanteFiscal.findUniqueOrThrow({
        where: { id: COMPROBANTE_FISCAL_MOSTRADOR_ID },
      });
      assert.equal(fila.monto_total.toNumber(), body.data.monto_total);
    });
  },
);
