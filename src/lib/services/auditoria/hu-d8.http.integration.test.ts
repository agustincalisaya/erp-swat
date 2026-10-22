import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-D8 T03 — `GET /api/auditoria/mi-historial` contra un servidor real
 * (molde de `auditoria-ventas.http.integration.test.ts`: la sesión depende de
 * `cookies()` de `next/headers`, así que 401 y alcance por sesión solo se
 * prueban con un servidor levantado).
 *
 * Login real con `cajero.seed` / `encargado.seed` / `auditor.seed` (cada login
 * escribe su propio `LOGIN_EXITOSO`, así que todos tienen al menos un asiento)
 * y, para el 401 de cuenta no interna, `juan.perez@example.com` en la tienda.
 *
 * Opt-in: `HU_D8_INTEGRATION_BASE_URL` (ej. "http://localhost:3000") +
 * `HU_D8_INTEGRATION_DATABASE_URL` (misma base que el servidor); `skip` si
 * falta alguna. Corre con `npm run test:integration:d8-http`.
 */

const BASE_URL = process.env.HU_D8_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_D8_INTEGRATION_DATABASE_URL;
const PASSWORD_SEED = "abc123456789";

const USUARIO_CAJERO_SEED_ID = "1a2b3c4d-4444-4a1a-8a1a-000000000004";
const USUARIO_ENCARGADO_SEED_ID = "77b685fd-ac1c-4af5-9f59-48830d96c9ea";
const USUARIO_AUDITOR_SEED_ID = "0e273fcf-b944-4580-a610-062f7a92a384";

const CLAVES_DTO_PROPIO = ["accion", "created_at", "id", "registro_id", "tabla_afectada"];

async function loginInterno(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login falló para ${email}: ${JSON.stringify(body)}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("swat_session="));
  assert.ok(cookie, `login para ${email} no devolvió swat_session`);
  return cookie.split(";")[0]!;
}

async function loginTienda(email: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/tienda/cuenta/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD_SEED }),
  });
  if (res.status !== 200) return null;
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("swat_tienda_session="));
  return cookie ? cookie.split(";")[0]! : null;
}

function diaMas(dia: string, dias: number): string {
  const base = new Date(`${dia}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

type Registro = { id: string; accion: string; created_at: string; tabla_afectada: string; registro_id: string | null };

test(
  "HU-D8 — GET /api/auditoria/mi-historial contra un servidor real (401, alcance propio, rango ART, acciones, DTO)",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 120_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const [{ prisma }, { diaNegocioIso }] = await Promise.all([
      import("../../db/prisma.ts"),
      import("../../utils/fecha-negocio.ts"),
    ]);
    t.after(async () => prisma.$disconnect());

    const cookieCajero = await loginInterno("cajero.seed@erp-swat.local");
    const cookieEncargado = await loginInterno("encargado.seed@erp-swat.local");
    const cookieAuditor = await loginInterno("auditor.seed@erp-swat.local");
    // El asiento LOGIN_EXITOSO lo escribe el listener sin bloquear la respuesta.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const get = (ruta: string, cookie?: string) =>
      fetch(`${BASE_URL}${ruta}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
    const mio = (query: string, cookie?: string) => get(`/api/auditoria/mi-historial${query}`, cookie);

    const idsDe = async (usuarioId: string) =>
      new Set((await prisma.auditLog.findMany({ where: { usuario_id: usuarioId }, select: { id: true } })).map((r) => r.id));

    await t.test("sin sesión → 401 UNAUTHORIZED", async () => {
      const res = await mio("");
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { data: null, error: { code: "UNAUTHORIZED", message: "Sesión requerida" } });
    });

    await t.test("cookie de la tienda (cuenta no interna) → 401", async (st) => {
      const falsa = await mio("", "swat_tienda_session=token-cualquiera");
      assert.equal(falsa.status, 401);

      const cookieTienda = await loginTienda("juan.perez@example.com");
      if (!cookieTienda) {
        st.skip("juan.perez@example.com no pudo iniciar sesión en la tienda (estado alterado por otra suite)");
        return;
      }
      const res = await mio("", cookieTienda);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error.code, "UNAUTHORIZED");
    });

    await t.test("D8-1/D8-5 — cajero.seed → 200 solo con sus asientos (incluye su LOGIN_EXITOSO)", async () => {
      const res = await mio("?page_size=100", cookieCajero);
      assert.equal(res.status, 200);
      const { data, error } = await res.json();
      assert.equal(error, null);
      const propios = await idsDe(USUARIO_CAJERO_SEED_ID);
      assert.equal(data.total, propios.size);
      assert.ok((data.registros as Registro[]).every((r) => propios.has(r.id)));
      assert.ok((data.registros as Registro[]).some((r) => r.accion === "LOGIN_EXITOSO"));
      assert.equal(data.page, 1);
      assert.equal(data.page_size, 100);
    });

    await t.test("D8-1 — usuario_id / userId de otro usuario (válido o malformado) se ignoran, sin 400", async () => {
      const base = await (await mio("?page_size=100", cookieCajero)).json();
      const ajenos = await idsDe(USUARIO_ENCARGADO_SEED_ID);
      for (const q of [
        `?page_size=100&usuario_id=${USUARIO_ENCARGADO_SEED_ID}`,
        `?page_size=100&userId=${USUARIO_ENCARGADO_SEED_ID}`,
        "?page_size=100&usuario_id=no-es-uuid",
      ]) {
        const res = await mio(q, cookieCajero);
        assert.equal(res.status, 200, q);
        const { data } = await res.json();
        assert.deepEqual(data, base.data, q);
        assert.ok((data.registros as Registro[]).every((r) => !ajenos.has(r.id)), q);
      }
    });

    await t.test("D8-3 — un solo día ART incluye el login de hoy; hasta = día anterior lo excluye", async () => {
      const ultimo = await prisma.auditLog.findFirst({
        where: { usuario_id: USUARIO_CAJERO_SEED_ID },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { id: true, created_at: true },
      });
      assert.ok(ultimo);
      const dia = diaNegocioIso(ultimo.created_at);
      const ids = async (q: string) =>
        ((await (await mio(`?page_size=100${q}`, cookieCajero)).json()).data.registros as Registro[]).map((r) => r.id);
      assert.ok((await ids(`&fecha_desde=${dia}&fecha_hasta=${dia}`)).includes(ultimo.id));
      assert.ok(!(await ids(`&fecha_hasta=${diaMas(dia, -1)}`)).includes(ultimo.id));
    });

    await t.test("D8-3 — desde > hasta, día inexistente y page_size > 100 → 400 VALIDATION_ERROR", async () => {
      const invertido = await mio("?fecha_desde=2026-10-21&fecha_hasta=2026-10-20", cookieCajero);
      assert.equal(invertido.status, 400);
      const body = await invertido.json();
      assert.equal(body.data, null);
      assert.equal(body.error.code, "VALIDATION_ERROR");
      assert.ok(body.error.fieldErrors.fecha_hasta);
      for (const q of ["?fecha_desde=2026-02-30", "?page_size=500", "?fecha_hasta=20/10/2026"]) {
        assert.equal((await mio(q, cookieCajero)).status, 400, q);
      }
    });

    await t.test("D8-4 — acción que el cajero no tiene → 200 vacío", async () => {
      const deEncargado = await prisma.auditLog.findMany({
        where: { usuario_id: USUARIO_ENCARGADO_SEED_ID },
        distinct: ["accion"],
        select: { accion: true },
      });
      const delCajero = new Set(
        (await prisma.auditLog.findMany({ where: { usuario_id: USUARIO_CAJERO_SEED_ID }, distinct: ["accion"], select: { accion: true } }))
          .map((r) => r.accion),
      );
      const ajena = deEncargado.map((r) => r.accion).find((a) => !delCajero.has(a)) ?? "HU_D8_ACCION_INEXISTENTE";
      const res = await mio(`?accion=${encodeURIComponent(ajena)}`, cookieCajero);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.deepEqual(data.registros, []);
      assert.equal(data.total, 0);
    });

    await t.test("D8-4 — acciones_disponibles = DISTINCT de acciones propias", async () => {
      const { data } = await (await mio("", cookieCajero)).json();
      const esperado = (
        await prisma.auditLog.findMany({
          where: { usuario_id: USUARIO_CAJERO_SEED_ID },
          distinct: ["accion"],
          select: { accion: true },
          orderBy: { accion: "asc" },
        })
      ).map((r) => r.accion);
      assert.deepEqual(data.acciones_disponibles, esperado);
    });

    await t.test("D8-6 — el JSON no trae payloads, hashes, IP ni usuario", async () => {
      const res = await mio("?page_size=100", cookieCajero);
      const texto = await res.text();
      assert.doesNotMatch(texto, /valor_anterior|valor_nuevo|hash_anterior|hash_actual|"ip"|usuario_id|usuario_nombre/);
      for (const r of JSON.parse(texto).data.registros as Registro[]) assert.deepEqual(Object.keys(r).sort(), CLAVES_DTO_PROPIO);
    });

    await t.test("D8-2 — paginación estable: página 1 + página 2 = primeras posiciones del listado completo", async () => {
      const todo = (await (await mio("?page_size=100", cookieCajero)).json()).data.registros as Registro[];
      const p1 = (await (await mio("?page=1&page_size=1", cookieCajero)).json()).data;
      const p2 = (await (await mio("?page=2&page_size=1", cookieCajero)).json()).data;
      assert.equal(p1.page_size, 1);
      assert.deepEqual([...p1.registros, ...p2.registros].map((r: Registro) => r.id), todo.slice(0, 2).map((r) => r.id));
    });

    await t.test("D8-5/D8-7 — auditor.seed en mi-historial también ve solo lo suyo", async () => {
      const { data } = await (await mio("?page_size=100", cookieAuditor)).json();
      const propios = await idsDe(USUARIO_AUDITOR_SEED_ID);
      assert.equal(data.total, propios.size);
      assert.ok((data.registros as Registro[]).every((r) => propios.has(r.id)));
    });

    await t.test("D8-1 — GET /api/auditoria/logs sin permiso forense delega: mismo DTO reducido, tercero ignorado", async () => {
      const res = await get(`/api/auditoria/logs?page_size=100&usuario_id=${USUARIO_ENCARGADO_SEED_ID}`, cookieCajero);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      const { data: propio } = await (await mio("?page_size=100", cookieCajero)).json();
      const { acciones_disponibles: _acciones, ...listado } = propio;
      assert.deepEqual(data, listado);
    });

    await t.test("forense intacto — auditor.seed en /api/auditoria/logs ve otros usuarios con IP y detalle", async () => {
      const res = await get(`/api/auditoria/logs?page_size=5&usuario_id=${USUARIO_CAJERO_SEED_ID}`, cookieAuditor);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.ok(data.registros.length >= 1);
      for (const r of data.registros) {
        assert.equal(r.usuario_id, USUARIO_CAJERO_SEED_ID);
        assert.ok("ip" in r && "usuario_nombre" in r && "valor_nuevo" in r);
      }
    });

    await t.test("UI — /auditoria/logs redirige al operativo a /auditoria/mi-historial; el auditor sigue en la Consola", async () => {
      // `redirect()` responde 307; si el layout ya empezó a hacer streaming,
      // Next lo emite como meta-redirect dentro de un 200 (doc de `redirect`).
      const operativo = await get("/auditoria/logs?accion=LOGIN_EXITOSO", cookieCajero);
      if (operativo.status === 200) {
        assert.match(await operativo.text(), /\/auditoria\/mi-historial\?accion=LOGIN_EXITOSO/);
      } else {
        assert.ok([303, 307, 308].includes(operativo.status), `status ${operativo.status}`);
        assert.match(operativo.headers.get("location") ?? "", /\/auditoria\/mi-historial\?accion=LOGIN_EXITOSO$/);
      }

      const auditor = await get("/auditoria/logs", cookieAuditor);
      assert.equal(auditor.status, 200);
      assert.match(await auditor.text(), /Auditoría Forense/);

      const vista = await get("/auditoria/mi-historial", cookieCajero);
      assert.equal(vista.status, 200);
      assert.match(await vista.text(), /Mi historial de acciones/);
    });

    await t.test("encargado.seed ve su propio historial (otro operativo, mismo contrato)", async () => {
      const { data } = await (await mio("?page_size=100", cookieEncargado)).json();
      const propios = await idsDe(USUARIO_ENCARGADO_SEED_ID);
      assert.equal(data.total, propios.size);
    });
  },
);
