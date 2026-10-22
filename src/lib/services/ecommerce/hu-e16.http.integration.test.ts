import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-E16 — Nivel 2 HTTP: `PATCH /api/ecommerce/catalogo/[producto_web_id]/visibilidad`
 * (spec_modulo_E.md §6.2; docs/modulos/modulo E/HU16_TASKS.md T04).
 *
 * 1. En proceso (siempre corre): el Route Handler real con `respuesta-catalogo`
 *    real y el servicio simulado. Cubre el envelope 422 con `details`, el 503
 *    sin `details` y que ningún otro código exponga `details`. El fallo y el
 *    timeout de D.3 no se pueden provocar en un servidor aparte: su camino de
 *    servicio está en `hu-e16.integration.test.ts` y el mapeo HTTP, acá.
 * 2. Servidor APARTE apuntando a la base de test (molde de
 *    `hu-e5.http.integration.test.ts`). Las dos variables deben apuntar a la
 *    MISMA base:
 *
 *   HU_E16_INTEGRATION_BASE_URL=http://localhost:3116 HU_E16_INTEGRATION_DATABASE_URL=$TEST_DB \
 *   npm run test:integration:e16-http
 *
 * Nunca se borra nada (Regla N.° 1).
 */

const BASE_URL = process.env.HU_E16_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E16_INTEGRATION_DATABASE_URL;
const PASSWORD_INTERNO = "abc123456789";
const CONTENIDO_WEB_E16_SIN_FOTO_ID = "4f151400-53c6-4e19-9f0c-53bf8a2c6438";
const ID_VALIDO = "4f151400-53c6-4e19-9f0c-53bf8a2c6438";

// ──────────────────────────────────────────────────────────────────────────────
// 1. Route Handler en proceso
// ──────────────────────────────────────────────────────────────────────────────

test("HU-E16 HTTP (en proceso) — envelope 422 con details, 503 sin details, otros códigos sin details", async () => {
  const [{ cargarAislado }, { ServiceError }, schema, nextServer] = await Promise.all([
    import("./comprobante-pdf.test-helpers.ts"),
    import("../../errors/service-error.ts"),
    import("../../schemas/ecommerce.schema.ts"),
    import("next/server"),
  ]);
  const respuesta = cargarAislado<Record<string, unknown>>(new URL("./respuesta-catalogo.ts", import.meta.url), {
    "server-only": {},
    "next/server": nextServer,
    "@/lib/errors/service-error": { ServiceError },
    "@/lib/schemas/ecommerce.schema": schema,
  });

  let lanzar: unknown = null;
  const llamadas: unknown[][] = [];
  const ruta = cargarAislado<{ PATCH: (req: Request, ctx: unknown) => Promise<Response> }>(
    new URL("../../../app/api/ecommerce/catalogo/[producto_web_id]/visibilidad/route.ts", import.meta.url),
    {
      "@/lib/auth/permisos-ecommerce": { PERMISO_GESTIONAR_CATALOGO: "ecommerce:gestionar_catalogo" },
      "@/lib/auth/with-permission": {
        withPermission: (_permiso: string, h: (req: Request, s: unknown, ctx: unknown) => Promise<Response>) =>
          (req: Request, ctx: unknown) => h(req, { userId: "actor-1", nombreUsuario: "admin" }, ctx),
      },
      "@/lib/schemas/ecommerce.schema": schema,
      "@/lib/services/ecommerce/respuesta-catalogo": respuesta,
      "@/lib/services/ecommerce/visibilidad-web.service": {
        cambiarVisibilidadWeb: async (...args: unknown[]) => {
          llamadas.push(args);
          if (lanzar) throw lanzar;
          return { producto_web_id: args[0], visibilidad_web: (args[1] as { visibilidad_web: boolean }).visibilidad_web };
        },
      },
    },
  );
  const patch = async (body: unknown) => {
    const req = new nextServer.NextRequest(`http://test/api/ecommerce/catalogo/${ID_VALIDO}/visibilidad`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await ruta.PATCH(req, { params: Promise.resolve({ producto_web_id: ID_VALIDO }) });
    return { status: res.status, body: await res.json() };
  };

  for (const faltantes of [["foto"], ["descripcion"], ["descripcion", "foto"]]) {
    lanzar = new ServiceError("CONTENIDO_NO_PUBLICABLE", "No se puede mostrar en la tienda", { faltantes });
    const r = await patch({ visibilidad_web: true });
    assert.equal(r.status, 422);
    assert.deepEqual(r.body, {
      data: null,
      error: { code: "CONTENIDO_NO_PUBLICABLE", message: "No se puede mostrar en la tienda", details: { faltantes } },
    });
  }

  lanzar = new ServiceError("AUDITORIA_NO_DISPONIBLE", "No se pudo registrar el intento.", { no: "exponer" });
  const r503 = await patch({ visibilidad_web: true });
  assert.equal(r503.status, 503);
  assert.deepEqual(r503.body, { data: null, error: { code: "AUDITORIA_NO_DISPONIBLE", message: "No se pudo registrar el intento." } });

  lanzar = new ServiceError("PRODUCTO_WEB_NO_ENCONTRADO", "No existe", { no: "exponer" });
  const r404 = await patch({ visibilidad_web: false });
  assert.equal(r404.status, 404);
  assert.equal("details" in r404.body.error, false, "solo CONTENIDO_NO_PUBLICABLE expone details");

  lanzar = null;
  const ok = await patch({ visibilidad_web: false });
  assert.deepEqual(ok, { status: 200, body: { data: { producto_web_id: ID_VALIDO, visibilidad_web: false }, error: null } });
  assert.deepEqual(llamadas.at(-1), [ID_VALIDO, { visibilidad_web: false }, "actor-1"], "el actor sale de la sesión");
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Servidor aparte contra la base de test
// ──────────────────────────────────────────────────────────────────────────────

class Jar {
  private readonly cookies = new Map<string, string>();
  absorber(response: Response) {
    for (const linea of response.headers.getSetCookie()) {
      const [par] = linea.split(";");
      const [nombre, ...resto] = par.split("=");
      const valor = resto.join("=");
      if (!valor || /expires=Thu, 01 Jan 1970/i.test(linea)) this.cookies.delete(nombre.trim());
      else this.cookies.set(nombre.trim(), valor);
    }
  }
  header() {
    return [...this.cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join("; ");
  }
}

async function llamar(jar: Jar, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie: jar.header(), ...(init.headers ?? {}) },
  });
  jar.absorber(response);
  const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
  return { status: response.status, body, response };
}

const patch = (jar: Jar, path: string, body: unknown) =>
  llamar(jar, path, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) });

test(
  "HU-E16 HTTP — PATCH visibilidad contra un servidor real y la base de test",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 300_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const [{ prisma }, fixtures] = await Promise.all([import("@/lib/db/prisma"), import("./hu-e1.test-fixtures")]);
    t.after(async () => prisma.$disconnect());

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e16-http] current_database() = ${db}`);

    async function loginInterno(usuario: string) {
      const jar = new Jar();
      const { email } = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: usuario }, select: { email: true } });
      const login = await llamar(jar, "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PASSWORD_INTERNO }) });
      assert.equal(login.status, 200, `login ${usuario}`);
      return jar;
    }
    const admin = await loginInterno("admin.ecommerce.seed");
    const operador = await loginInterno("operador.pickpack.seed");
    const ruta = (id: string) => `/api/ecommerce/catalogo/${id}/visibilidad`;
    const asientos = (id: string) =>
      prisma.auditLog.count({ where: { accion: "ecommerce:publicacion_web_rechazada", registro_id: id } });

    async function crear(opciones: { visible?: boolean; descripcion?: string; sinFotos?: boolean } = {}) {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 3, visible: opciones.visible ?? false });
      if (opciones.descripcion !== undefined) {
        await prisma.productoWebContenido.update({ where: { id: a.productoWebId }, data: { descripcion: opciones.descripcion } });
      }
      if (opciones.sinFotos) {
        await prisma.productoWebFoto.updateMany({
          where: { producto_web_contenido_id: a.productoWebId },
          data: { is_active: false, deleted_at: new Date(), deletion_reason: "Fixture HU-E16 sin foto" },
        });
      }
      return a;
    }

    await t.test("E16-1/E16-2 — 422 CONTENIDO_NO_PUBLICABLE con details.faltantes; sin UPDATE; un asiento por request", async () => {
      const casos: [Parameters<typeof crear>[0], string[]][] = [
        [{ sinFotos: true }, ["foto"]],
        [{ descripcion: "   " }, ["descripcion"]],
        [{ descripcion: "", sinFotos: true }, ["descripcion", "foto"]],
      ];
      for (const [opciones, faltantes] of casos) {
        const a = await crear(opciones);
        const antes = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
        for (let i = 1; i <= 2; i++) {
          const r = await patch(admin, ruta(a.productoWebId), { visibilidad_web: true, motivo: "Intento E16" });
          assert.equal(r.status, 422, JSON.stringify(r.body));
          assert.equal(r.body.data, null);
          assert.equal(r.body.error.code, "CONTENIDO_NO_PUBLICABLE");
          assert.deepEqual(r.body.error.details, { faltantes });
          assert.equal(await asientos(a.productoWebId), i, "el asiento ya está persistido al recibir el 422");
        }
        const despues = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
        assert.equal(despues.visibilidad_web, false);
        assert.equal(despues.updated_at.getTime(), antes.updated_at.getTime(), "mutación nula");
      }
    });

    await t.test("E16-5 — contenido sembrado: 422 ['foto'] y sigue oculto", async () => {
      const r = await patch(admin, ruta(CONTENIDO_WEB_E16_SIN_FOTO_ID), { visibilidad_web: true });
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.deepEqual(r.body.error.details, { faltantes: ["foto"] });
      const c = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: CONTENIDO_WEB_E16_SIN_FOTO_ID } });
      assert.equal(c.visibilidad_web, false);
    });

    await t.test("E5 — mostrar publicable, ocultar no publicable y no-op: 200 con el body E5 y sin details", async () => {
      const a = await crear();
      assert.deepEqual((await patch(admin, ruta(a.productoWebId), { visibilidad_web: true })).body, {
        data: { producto_web_id: a.productoWebId, visibilidad_web: true },
        error: null,
      });
      const b = await crear({ visible: true, sinFotos: true });
      const noop = await patch(admin, ruta(b.productoWebId), { visibilidad_web: true });
      assert.equal(noop.status, 200, "visible no publicable → pedir visible es el no-op E5");
      assert.equal(await asientos(b.productoWebId), 0);
      const oculto = await patch(admin, ruta(b.productoWebId), { visibilidad_web: false });
      assert.deepEqual(oculto.body, { data: { producto_web_id: b.productoWebId, visibilidad_web: false }, error: null });
    });

    await t.test("400/401/403/404 sin cambios de contrato", async () => {
      const a = await crear({ sinFotos: true });
      assert.equal((await patch(admin, ruta("no-es-uuid"), { visibilidad_web: true })).status, 400);
      assert.equal((await patch(admin, ruta(a.productoWebId), { visibilidad_web: "true" })).status, 400);
      assert.equal((await patch(new Jar(), ruta(a.productoWebId), { visibilidad_web: true })).status, 401);
      assert.equal((await patch(operador, ruta(a.productoWebId), { visibilidad_web: true })).status, 403);
      const r404 = await patch(admin, ruta("00000000-0000-4000-8000-000000000000"), { visibilidad_web: true });
      assert.equal(r404.status, 404);
      assert.equal("details" in r404.body.error, false);
      assert.equal(await asientos(a.productoWebId), 0, "400/401/403 no llegan al servicio");
    });
  },
);
