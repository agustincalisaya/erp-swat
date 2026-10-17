import assert from "node:assert/strict";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-B4 (`POST /api/ventas/[id]/override-descuento`)
 * — mismo patrón y mismo motivo que `rbac-hu-b8.integration.test.ts`:
 * `withPermission()`/`withAuth()` dependen de `cookies()` de `next/headers`
 * (AsyncLocalStorage poblado solo por el runtime real de Next al atender un
 * request), así que 401/403 de sesión real solo se pueden verificar pegando
 * contra un servidor real (`npm run dev` / `next start`), no invocando el
 * `route.ts` a mano.
 *
 * `pedido-venta.integration.test.ts` (a nivel de servicio, sin HTTP) ya
 * cubre el resto del contrato (flujo feliz de descuento/precio, TRANSICION_INVALIDA,
 * SIN_PERMISO_AUTORIZACION a nivel de servicio) contra Postgres real — este
 * archivo agrega específicamente lo que solo se puede probar con sesión HTTP
 * real: 401 sin sesión y 403 vía la ruta completa (Route Handler → servicio).
 *
 * Opt-in vía `HU_B4_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"),
 * `skip` si no está seteada.
 */

const BASE_URL = process.env.HU_B4_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_SUPERVISOR_VENTAS_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000005";
const VARIANTE_BORCEGOS_2_ID = "79f41b7f-a667-4867-b3cc-2c73f6134086";

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
  "HU-B4 — POST /api/ventas/[id]/override-descuento contra un servidor real (401/403/200/409)",
  { skip: !BASE_URL, timeout: 30_000 },
  async (t) => {
    const [{ prisma }] = await Promise.all([import("../../db/prisma.ts")]);
    t.after(() => prisma.$disconnect());

    // PedidoVenta/PedidoVentaItem ad-hoc — no toca el fixture de seed
    // V-2026-000003 (mismo criterio que `pedido-venta.integration.test.ts`).
    const pedido = await prisma.pedidoVenta.create({
      data: {
        numero_venta: `V-TEST-B4-HTTP-${Date.now()}`,
        registrado_por_id: USUARIO_CAJERO_SEED_ID,
        estado: "RESERVADO",
        total: 41500,
        items: {
          create: {
            variante_sku_id: VARIANTE_BORCEGOS_2_ID,
            cantidad: 1,
            precio_unitario: 41500,
            requiere_autorizacion: true,
          },
        },
      },
      select: { id: true },
    });

    await t.test(`POST /api/ventas/${pedido.id}/override-descuento sin sesión devuelve 401`, async () => {
      const res = await fetch(`${BASE_URL}/api/ventas/${pedido.id}/override-descuento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          descuento_porcentual_solicitado: 10,
          motivo: "test",
          supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
        }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("con sesión de cajero.seed pero supervisor_credencial.usuario_id = cajero.seed (sin permiso) devuelve 403 SIN_PERMISO_AUTORIZACION", async () => {
      const cookie = await loginReal("cajero.seed@erp-swat.local");
      const res = await fetch(`${BASE_URL}/api/ventas/${pedido.id}/override-descuento`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          descuento_porcentual_solicitado: 10,
          motivo: "test",
          supervisor_credencial: { usuario_id: USUARIO_CAJERO_SEED_ID },
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(body.error.code, "SIN_PERMISO_AUTORIZACION");
    });

    let autorizacionId = "";

    await t.test("con sesión de cajero.seed y supervisor.ventas.seed como autorizante devuelve 200 OK", async () => {
      const cookie = await loginReal("cajero.seed@erp-swat.local");
      const res = await fetch(`${BASE_URL}/api/ventas/${pedido.id}/override-descuento`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, "User-Agent": "HU-B4-http-integration-test" },
        body: JSON.stringify({
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          descuento_porcentual_solicitado: 12.5,
          motivo: "Cliente institucional",
          supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.descuento_aplicado, 12.5);
      assert.equal(body.data.autorizado_por, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
      autorizacionId = body.data.autorizacion_id;
      assert.match(autorizacionId, /^[0-9a-f-]{36}$/);

      const item = await prisma.pedidoVentaItem.findFirstOrThrow({
        where: { pedido_venta_id: pedido.id },
        select: { requiere_autorizacion: true, autorizado_por_id: true },
      });
      assert.equal(item.requiere_autorizacion, false);
      assert.equal(item.autorizado_por_id, USUARIO_SUPERVISOR_VENTAS_SEED_ID);
    });

    await t.test("repetir el mismo request sobre el ítem ya autorizado devuelve 409 TRANSICION_INVALIDA", async () => {
      const cookie = await loginReal("cajero.seed@erp-swat.local");
      const res = await fetch(`${BASE_URL}/api/ventas/${pedido.id}/override-descuento`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          variante_sku_id: VARIANTE_BORCEGOS_2_ID,
          descuento_porcentual_solicitado: 5,
          motivo: "segundo intento",
          supervisor_credencial: { usuario_id: USUARIO_SUPERVISOR_VENTAS_SEED_ID },
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(body.error.code, "TRANSICION_INVALIDA");
    });

    await t.test("el autorizacion_id de la respuesta HTTP quedó materializado dentro de valor_nuevo del AuditLog real", async () => {
      let filas: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
      for (let intento = 0; intento < 20 && filas.length === 0; intento++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        filas = await prisma.auditLog.findMany({
          where: { tabla_afectada: "pedidos_venta", registro_id: pedido.id, accion: "DESCUENTO_FUERA_MARGEN" },
        });
      }
      assert.equal(filas.length, 1);
      const valorNuevo = filas[0]!.valor_nuevo as { autorizacion_id?: string } | null;
      assert.equal(valorNuevo?.autorizacion_id, autorizacionId);
    });
  },
);
