import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Verificación end-to-end HTTP de HU-C3 (`POST/GET /api/clientes/[id]/direcciones`)
 * — mismo patrón y mismo motivo que `pedido-venta.http.integration.test.ts`:
 * `withPermission()`/`withAuth()` dependen de `cookies()` de `next/headers`
 * (AsyncLocalStorage poblado solo por el runtime real de Next al atender un
 * request), así que un 401/403 de sesión real y el mapeo de status HTTP del
 * Route Handler solo se pueden verificar pegando contra un servidor real
 * (`npm run dev` / `next start`), no invocando el `route.ts` a mano.
 *
 * `direccion-cliente.integration.test.ts` (nivel de servicio) ya cubre el
 * resto del contrato contra Postgres real (FACTURACION como primera
 * dirección, ENVIO con FACTURACION previa, 422 sin escritura, listado,
 * auditoría) — este archivo agrega SOLO lo que necesita sesión HTTP real:
 *   - W-1: 401 sin sesión y 403 con sesiones reales sin el permiso
 *     (`auditor.seed` tiene `clientes:leer` pero NO `clientes:editar`;
 *     `cajero.seed` no tiene ningún `clientes:*`).
 *   - W-2: el mapeo de status del Route Handler (201/400/404/422/200) y el
 *     HTML server-rendered de la ficha `/clientes/[id]`.
 *
 * `vendedor.seed` (sembrado junto con esta suite) es el único usuario del
 * seed con el rol VENDEDOR, es decir con `clientes:editar`: sin él no existe
 * camino feliz HTTP ni ficha navegable para el equipo.
 *
 * Opt-in vía `HU_C3_INTEGRATION_BASE_URL` (ej. "http://localhost:3100"),
 * `skip` si no está seteada.
 *
 * Requisito operativo del server base: si es un `npm run dev`, compila cada
 * ruta en su PRIMER request. Sobre un dev server frío esa compilación puede
 * comerse el presupuesto de 30s de esta suite (verificado en esta ronda: el
 * primer POST tardó ~29s y el timeout del test padre canceló los subtests).
 * Por eso hay que "calentar" las rutas antes de correrla — un login real,
 * un GET autenticado a `/clientes/<id>` y un POST/GET a
 * `/api/clientes/<id>/direcciones` — o correr contra un `next start` ya
 * buildeado. Con las rutas compiladas la suite completa corre en ~3s.
 *
 * Alcance explícito: la verificación SSR de abajo prueba la salida
 * server-rendered. El submit del formulario cliente (`DireccionesCliente`:
 * Server Action + `router.refresh()`) NO se ejercita acá — eso queda para un
 * pase manual en navegador.
 */

const BASE_URL = process.env.HU_C3_INTEGRATION_BASE_URL;
const PASSWORD_SEED = "abc123456789";

const CLIENTE_JUAN_PEREZ_ID = "1a2b3c4d-eeee-4a1a-8a1a-000000000001";
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
  "HU-C3 — rutas de direcciones contra un servidor real (401/403/201/400/404/422/200) + ficha SSR",
  { skip: !BASE_URL, timeout: 30_000 },
  async (t) => {
    const [{ prisma }] = await Promise.all([import("../../db/prisma.ts")]);
    t.after(() => prisma.$disconnect());

    // Fixtures ad-hoc (no se depende de los clientes del seed, salvo la
    // ficha sembrada que se usa a propósito en el chequeo SSR). NUNCA se
    // borra físicamente: cualquier baja es un UPDATE de baja lógica
    // (RULES.md Regla N.° 1).
    const clienteHttp = await prisma.cliente.create({
      data: { dni: dniNuevo(), nombre: "Cliente HU-C3 HTTP" },
      select: { id: true },
    });
    const clienteVacio = await prisma.cliente.create({
      data: { dni: dniNuevo(), nombre: "Cliente HU-C3 HTTP vacio" },
      select: { id: true },
    });

    const urlHttp = `${BASE_URL}/api/clientes/${clienteHttp.id}/direcciones`;
    const urlVacio = `${BASE_URL}/api/clientes/${clienteVacio.id}/direcciones`;

    const cuerpoFacturacion = {
      rotulo: "Casa HTTP",
      tipo: "FACTURACION",
      direccion_completa: "Av. Siempreviva 742",
    };

    // ── 1/2. Sin sesión: 401 en ambas rutas ────────────────────────────────
    await t.test("POST sin sesión devuelve 401", async () => {
      const res = await fetch(urlHttp, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoFacturacion),
      });
      assert.equal(res.status, 401);
    });

    await t.test("GET sin sesión devuelve 401", async () => {
      const res = await fetch(urlHttp);
      assert.equal(res.status, 401);
    });

    // ── 3. auditor.seed: tiene clientes:leer, NO clientes:editar ────────────
    await t.test("POST con sesión de auditor.seed (clientes:leer sin clientes:editar) devuelve 403 y no escribe", async () => {
      const cookie = await loginReal("auditor.seed@erp-swat.local");
      const antes = await prisma.direccionCliente.count({ where: { cliente_id: clienteHttp.id } });
      const res = await fetch(urlHttp, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(cuerpoFacturacion),
      });
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(body.error.code, "FORBIDDEN");
      assert.equal(
        await prisma.direccionCliente.count({ where: { cliente_id: clienteHttp.id } }),
        antes,
        "un 403 no debe escribir ninguna dirección",
      );
    });

    // ── 4. cajero.seed: sin ningún permiso clientes:* ───────────────────────
    await t.test("GET con sesión de cajero.seed (sin clientes:*) devuelve 403", async () => {
      const cookie = await loginReal("cajero.seed@erp-swat.local");
      const res = await fetch(urlHttp, { headers: { Cookie: cookie } });
      const body = await res.json();
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(body.error.code, "FORBIDDEN");
    });

    // ── 5. vendedor.seed: camino feliz + mapeo de status ────────────────────
    const cookieVendedor = await loginReal("vendedor.seed@erp-swat.local");

    let direccionFacturacionId = "";

    await t.test("POST con sesión de vendedor.seed crea la FACTURACION con 201 (el id del path gana sobre un cliente_id espurio del body)", async () => {
      const res = await fetch(urlHttp, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        // `cliente_id` espurio: el schema no es `.strict()` y el handler jamás
        // lo lee (spec §2.3) — la fila debe quedar en `clienteHttp`.
        body: JSON.stringify({ ...cuerpoFacturacion, cliente_id: clienteVacio.id }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.error, null);
      assert.match(body.data.direccion_id, /^[0-9a-f-]{36}$/);
      assert.equal(body.data.rotulo, "Casa HTTP");
      assert.equal(body.data.tipo, "FACTURACION");
      direccionFacturacionId = body.data.direccion_id;

      const fila = await prisma.direccionCliente.findUniqueOrThrow({
        where: { id: direccionFacturacionId },
        select: { cliente_id: true, tipo: true, is_active: true },
      });
      assert.equal(fila.cliente_id, clienteHttp.id, "el cliente_id del body debe descartarse");
      assert.equal(fila.tipo, "FACTURACION");
      assert.equal(fila.is_active, true);
    });

    await t.test("POST con sesión de vendedor.seed crea una ENVIO con 201 sobre el mismo cliente", async () => {
      const res = await fetch(urlHttp, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        body: JSON.stringify({
          rotulo: "Depósito HTTP",
          tipo: "ENVIO",
          direccion_completa: "Ruta 9 Km 4, Salta",
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.data.tipo, "ENVIO");
    });

    await t.test("POST de una ENVIO sin FACTURACION activa devuelve 422 DIRECCION_FACTURACION_REQUERIDA y no escribe", async () => {
      const antes = await prisma.direccionCliente.count({ where: { cliente_id: clienteVacio.id } });
      assert.equal(antes, 0, "el fixture debe arrancar sin direcciones");
      const res = await fetch(urlVacio, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        body: JSON.stringify({
          rotulo: "Depósito",
          tipo: "ENVIO",
          direccion_completa: "Ruta 9 Km 4, Salta",
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(body.error.code, "DIRECCION_FACTURACION_REQUERIDA");
      assert.equal(
        await prisma.direccionCliente.count({ where: { cliente_id: clienteVacio.id } }),
        antes,
        "el 422 no debe escribir ninguna fila",
      );
    });

    await t.test("body inválido (direccion_completa < 5 y rótulo vacío) devuelve 400 VALIDATION_ERROR", async () => {
      const invalidos = [
        { ...cuerpoFacturacion, direccion_completa: "Casa" },
        { ...cuerpoFacturacion, rotulo: "" },
      ];
      for (const payload of invalidos) {
        const res = await fetch(urlHttp, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(body.error.code, "VALIDATION_ERROR");
      }
    });

    await t.test("cliente inexistente devuelve 404 CLIENTE_NO_ENCONTRADO", async () => {
      const res = await fetch(`${BASE_URL}/api/clientes/${randomUUID()}/direcciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        body: JSON.stringify(cuerpoFacturacion),
      });
      const body = await res.json();
      assert.equal(res.status, 404, JSON.stringify(body));
      assert.equal(body.error.code, "CLIENTE_NO_ENCONTRADO");
    });

    await t.test("GET con sesión de vendedor.seed devuelve 200 y SOLO las direcciones activas", async () => {
      // Tercera dirección + baja lógica directa de SETUP (nunca DELETE).
      const resExtra = await fetch(urlHttp, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieVendedor },
        body: JSON.stringify({
          rotulo: "Planta HTTP",
          tipo: "ENVIO",
          direccion_completa: "Ruta 8 km 12",
        }),
      });
      const extraId = (await resExtra.json()).data.direccion_id as string;
      await prisma.direccionCliente.update({
        where: { id: extraId },
        data: {
          is_active: false,
          deleted_at: new Date(),
          deleted_by: USUARIO_VENDEDOR_SEED_ID,
          deletion_reason: "Setup de la suite HTTP HU-C3: verificar filtro del listado",
        },
      });

      const res = await fetch(urlHttp, { headers: { Cookie: cookieVendedor } });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.error, null);
      const direcciones = body.data.direcciones as Array<{ id: string; is_active: boolean }>;
      assert.equal(direcciones.length, 2, "FACTURACION + ENVIO activas; la tercera quedó inactiva");
      assert.ok(direcciones.every((direccion) => direccion.is_active));
      assert.ok(
        !direcciones.some((direccion) => direccion.id === extraId),
        "el listado operativo no debe exponer direcciones inactivas",
      );
      assert.ok(direcciones.some((direccion) => direccion.id === direccionFacturacionId));
    });

    // ── 6. Ficha SSR (`/clientes/[id]`) — mitad automatizable de W-2 ────────
    // `redirect: "manual"`: si la cookie no autenticara, `proxy.ts` devolvería
    // 307 a /login y el assert de status lo detecta — en vez de seguir el
    // redirect y comparar contra el HTML del login.
    await t.test("la ficha server-rendered de Juan Pérez muestra la dirección sembrada", async () => {
      const res = await fetch(`${BASE_URL}/clientes/${CLIENTE_JUAN_PEREZ_ID}`, {
        headers: { Cookie: cookieVendedor },
        redirect: "manual",
      });
      assert.equal(res.status, 200, "la ficha debe renderizar, no redirigir a /login");
      const html = await res.text();
      assert.ok(
        html.includes("Belgrano 123, Salta Capital"),
        "el HTML server-rendered debe contener la dirección FACTURACION sembrada de Juan Pérez",
      );
    });

    await t.test("la ficha server-rendered de un cliente sin direcciones muestra el estado vacío", async () => {
      const res = await fetch(`${BASE_URL}/clientes/${clienteVacio.id}`, {
        headers: { Cookie: cookieVendedor },
        redirect: "manual",
      });
      assert.equal(res.status, 200, "la ficha debe renderizar, no redirigir a /login");
      const html = await res.text();
      assert.ok(
        html.includes("no tiene direcciones cargadas"),
        "el HTML debe contener el estado vacío de DireccionesCliente.tsx",
      );
    });

    // EVIDENCIA: prueba la salida server-rendered. El submit del formulario
    // cliente (Server Action + router.refresh()) queda para un pase manual.
    console.info("[HU-C3:HTTP:EVIDENCIA]", JSON.stringify({
      cliente_http_id: clienteHttp.id,
      cliente_vacio_id: clienteVacio.id,
      direccion_facturacion_id: direccionFacturacionId,
    }));
  },
);
