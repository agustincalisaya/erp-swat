import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-C9
 * (`PATCH /api/clientes/[id]/canal-contacto`) — mismo patrón y mismo motivo
 * que `direccion-cliente.http.integration.test.ts`: `withPermission()`/
 * `withAuth()` dependen de `cookies()` de `next/headers` (AsyncLocalStorage
 * poblado solo por el runtime real de Next al atender un request), así que un
 * 401/403 de sesión real y el mapeo de status HTTP del Route Handler solo se
 * pueden verificar pegando contra un servidor real (`npm run dev` /
 * `next start`), no invocando el `route.ts` a mano.
 *
 * `canal-contacto.integration.test.ts` (nivel de servicio) ya cubre el resto
 * del contrato contra Postgres real (persistencia null→WHATSAPP, re-edición,
 * 404, auditoría UPDATE) — este archivo agrega SOLO lo que necesita sesión
 * HTTP real:
 *   - 401 sin sesión y 403 con sesiones reales sin el permiso
 *     (`auditor.seed` tiene `clientes:leer` pero NO `clientes:editar`;
 *     `cajero.seed` no tiene ningún `clientes:*`).
 *   - el mapeo de status del Route Handler (200/400/404) y el HTML
 *     server-rendered de la ficha `/clientes/[id]` (precarga del canal actual
 *     y estado "Sin definir / no elegido").
 *
 * `vendedor.seed` es el único usuario del seed con el rol VENDEDOR, es decir
 * con `clientes:editar`: sin él no existe camino feliz HTTP ni ficha navegable.
 *
 * Opt-in vía `HU_C9_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"),
 * `skip` si no está seteada.
 *
 * Requisito operativo del server base — PITFALL DE COLD-COMPILE: si es un
 * `npm run dev`, compila cada ruta en su PRIMER request. Sobre un dev server
 * frío esa compilación puede comerse el presupuesto de 30s de esta suite. Por
 * eso hay que correr contra un `next start` ya buildeado (`npm run build` +
 * `npm start`) o "calentar" las rutas antes de correrla. NO se sube el
 * timeout de 30s para compensar: con las rutas compiladas la suite corre en
 * pocos segundos.
 *
 * Alcance explícito: la verificación SSR de abajo prueba la salida
 * server-rendered. El submit del formulario cliente (`CanalContactoCliente`:
 * Server Action + `router.refresh()`) NO se ejercita acá — eso queda para un
 * pase manual en navegador.
 */

const BASE_URL = process.env.HU_C9_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

const USUARIO_VENDEDOR_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000006";

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

/** DNI de 8 dígitos, distinto por corrida — los fixtures son ad-hoc. */
let secuenciaDni = 0;
function dniNuevo(): string {
  secuenciaDni += 1;
  return String(10_000_000 + ((Date.now() + secuenciaDni * 1013) % 89_999_999)).slice(0, 8);
}

test(
  "HU-C9 — PATCH canal-contacto contra un servidor real (401/403/400/404/200) + ficha SSR",
  { skip: !BASE_URL, timeout: 30_000 },
  async (t) => {
    const [{ prisma }] = await Promise.all([import("../../db/prisma.ts")]);
    t.after(() => prisma.$disconnect());

    // Fixtures ad-hoc (no se depende de los clientes del seed). NUNCA se
    // borra físicamente: cualquier baja es un UPDATE de baja lógica
    // (RULES.md Regla N.° 1).
    const clienteHttp = await prisma.cliente.create({
      data: { dni: dniNuevo(), nombre: "Cliente HU-C9 HTTP" },
      select: { id: true },
    });
    const clienteEmail = await prisma.cliente.create({
      data: { dni: dniNuevo(), nombre: "Cliente HU-C9 HTTP email", canal_preferido: "EMAIL" },
      select: { id: true },
    });
    const clienteSinCanal = await prisma.cliente.create({
      data: { dni: dniNuevo(), nombre: "Cliente HU-C9 HTTP sin canal", canal_preferido: null },
      select: { id: true },
    });
    const clienteInactivo = await prisma.cliente.create({
      data: {
        dni: dniNuevo(),
        nombre: "Cliente HU-C9 HTTP inactivo",
        is_active: false,
        deleted_at: new Date(),
        deleted_by: USUARIO_VENDEDOR_SEED_ID,
        deletion_reason: "Setup de la suite HTTP HU-C9",
      },
      select: { id: true },
    });

    const urlHttp = `${BASE_URL}/api/clientes/${clienteHttp.id}/canal-contacto`;

    // ── 1. Sin sesión: 401 ─────────────────────────────────────────────────
    await t.test("PATCH sin sesión devuelve 401", async () => {
      const res = await fetch(urlHttp, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal_preferido: "WHATSAPP" }),
      });
      assert.equal(res.status, 401);
    });

    // ── 2. auditor.seed: tiene clientes:leer, NO clientes:editar ───────────
    await t.test("PATCH con sesión de auditor.seed (clientes:leer sin clientes:editar) devuelve 403 y no escribe", async () => {
      const cookie = await loginReal("auditor.seed@erp-swat.local");
      const antes = await prisma.cliente.findUniqueOrThrow({
        where: { id: clienteHttp.id },
        select: { canal_preferido: true },
      });
      const res = await fetch(urlHttp, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ canal_preferido: "WHATSAPP" }),
      });
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(body.error.code, "FORBIDDEN");
      const despues = await prisma.cliente.findUniqueOrThrow({
        where: { id: clienteHttp.id },
        select: { canal_preferido: true },
      });
      assert.deepEqual(despues, antes, "un 403 no debe escribir el canal");
    });

    // ── 3. cajero.seed: sin ningún permiso clientes:* ──────────────────────
    await t.test("PATCH con sesión de cajero.seed (sin clientes:*) devuelve 403", async () => {
      const cookie = await loginReal("cajero.seed@erp-swat.local");
      const res = await fetch(urlHttp, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ canal_preferido: "WHATSAPP" }),
      });
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(body.error.code, "FORBIDDEN");
    });

    // ── 4. vendedor.seed: camino feliz ─────────────────────────────────────
    const cookieVendedor = await loginReal("vendedor.seed@erp-swat.local");

    await t.test("PATCH con sesión de vendedor.seed actualiza a WHATSAPP con 200 (el id del path gana sobre un cliente_id espurio del body)", async () => {
      const res = await fetch(urlHttp, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        // `cliente_id` espurio: el schema no es `.strict()` y el handler jamás
        // lo lee (spec §2.3) — sólo el cliente del path debe cambiar.
        body: JSON.stringify({ canal_preferido: "WHATSAPP", cliente_id: clienteEmail.id }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.error, null);
      assert.equal(body.data.cliente_id, clienteHttp.id);
      assert.equal(body.data.canal_preferido, "WHATSAPP");

      const fila = await prisma.cliente.findUniqueOrThrow({
        where: { id: clienteHttp.id },
        select: { canal_preferido: true },
      });
      assert.equal(fila.canal_preferido, "WHATSAPP");

      const espuria = await prisma.cliente.findUniqueOrThrow({
        where: { id: clienteEmail.id },
        select: { canal_preferido: true },
      });
      assert.equal(espuria.canal_preferido, "EMAIL", "el cliente_id del body debe descartarse");
    });

    await t.test("PATCH con re-edición a AMBOS devuelve 200 (editable repetidamente)", async () => {
      const res = await fetch(urlHttp, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        body: JSON.stringify({ canal_preferido: "AMBOS" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data.canal_preferido, "AMBOS");
    });

    // ── 5. Validación: 400 VALIDATION_ERROR ────────────────────────────────
    await t.test("body inválido (valor fuera del enum, null, vacío) devuelve 400 VALIDATION_ERROR", async () => {
      const invalidos = [
        { canal_preferido: "TELEGRAM" },
        { canal_preferido: null },
        { canal_preferido: "" },
        {},
      ];
      for (const payload of invalidos) {
        const res = await fetch(urlHttp, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(body.error.code, "VALIDATION_ERROR");
      }
    });

    // ── 6. Resolución del cliente: 404 ─────────────────────────────────────
    await t.test("cliente inexistente devuelve 404 CLIENTE_NO_ENCONTRADO", async () => {
      const res = await fetch(`${BASE_URL}/api/clientes/${randomUUID()}/canal-contacto`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        body: JSON.stringify({ canal_preferido: "WHATSAPP" }),
      });
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "CLIENTE_NO_ENCONTRADO");
    });

    await t.test("cliente inactivo devuelve 404 CLIENTE_NO_ENCONTRADO y no escribe", async () => {
      const res = await fetch(`${BASE_URL}/api/clientes/${clienteInactivo.id}/canal-contacto`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        body: JSON.stringify({ canal_preferido: "WHATSAPP" }),
      });
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "CLIENTE_NO_ENCONTRADO");
      const fila = await prisma.cliente.findUniqueOrThrow({
        where: { id: clienteInactivo.id },
        select: { canal_preferido: true },
      });
      assert.equal(fila.canal_preferido, null, "un cliente inactivo no debe ser modificado");
    });

    // ── 7. Ficha SSR (`/clientes/[id]`) — preload + estado sin definir ─────
    // `redirect: "manual"`: si la cookie no autenticara, `proxy.ts` devolvería
    // 307 a /login y el assert de status lo detecta.
    await t.test("la ficha server-rendered precarga el canal actual (EMAIL)", async () => {
      const res = await fetch(`${BASE_URL}/clientes/${clienteEmail.id}`, {
        headers: { Cookie: cookieVendedor },
        redirect: "manual",
      });
      assert.equal(res.status, 200, "la ficha debe renderizar, no redirigir a /login");
      const html = await res.text();
      // React intercala un separador de texto (`<!-- -->`) entre el literal y
      // el `<span>` del valor: el patrón tolera cualquier separador no-`<`
      // entre "Valor guardado:" y la etiqueta del canal.
      assert.match(
        html,
        /Valor guardado:[\s\S]*?>Email<\/span>/,
        "el HTML debe precargar EMAIL como valor actual del canal (no la primera opción)",
      );
    });

    await t.test("la ficha server-rendered de un cliente sin canal muestra 'Sin definir / no elegido'", async () => {
      const res = await fetch(`${BASE_URL}/clientes/${clienteSinCanal.id}`, {
        headers: { Cookie: cookieVendedor },
        redirect: "manual",
      });
      assert.equal(res.status, 200, "la ficha debe renderizar, no redirigir a /login");
      const html = await res.text();
      assert.match(
        html,
        /Valor guardado:[\s\S]*?>Sin definir \/ no elegido<\/span>/,
        "con canal null el selector debe mostrar 'Sin definir / no elegido', nunca WHATSAPP",
      );
    });

    // ── Cleanup: baja lógica de los fixtures (NUNCA delete) ────────────────
    for (const id of [clienteHttp.id, clienteEmail.id, clienteSinCanal.id, clienteInactivo.id]) {
      await prisma.cliente.update({
        where: { id },
        data: {
          is_active: false,
          deleted_at: new Date(),
          deleted_by: USUARIO_VENDEDOR_SEED_ID,
          deletion_reason: "Cleanup de la suite HTTP HU-C9 (baja lógica, nunca DELETE)",
        },
      });
    }

    // EVIDENCIA: prueba la salida server-rendered. El submit del formulario
    // cliente (Server Action + router.refresh()) queda para un pase manual.
    console.info("[HU-C9:HTTP:EVIDENCIA]", JSON.stringify({
      cliente_http_id: clienteHttp.id,
      cliente_email_id: clienteEmail.id,
      cliente_sin_canal_id: clienteSinCanal.id,
    }));
  },
);
