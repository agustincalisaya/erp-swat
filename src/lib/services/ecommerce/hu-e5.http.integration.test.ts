import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * HU-E5 — Nivel 2 HTTP: rutas de visibilidad web y baja lógica del contenido,
 * y el cron de mantenimiento, contra un servidor APARTE apuntando a la base
 * de test (mismo procedimiento que `hu-e4.http.integration.test.ts`). Las dos
 * variables deben apuntar a la MISMA base. `HU_E5_CRON_SECRET` es el
 * `CRON_SECRET` con el que se levantó ese servidor.
 *
 *   HU_E5_INTEGRATION_BASE_URL=http://localhost:3105 HU_E5_INTEGRATION_DATABASE_URL=$TEST_DB \
 *   HU_E5_CRON_SECRET=$CRON_SECRET npm run test:integration:e5-http
 *
 * Nunca se borra nada (Regla N.° 1).
 */

const BASE_URL = process.env.HU_E5_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E5_INTEGRATION_DATABASE_URL;
const CRON_SECRET = process.env.HU_E5_CRON_SECRET;
const PASSWORD_INTERNO = "abc123456789";
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";

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
  "HU-E5 HTTP — visibilidad web, baja lógica del contenido y cron de mantenimiento",
  { skip: !BASE_URL || !DATABASE_URL || !CRON_SECRET, timeout: 300_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const [{ prisma }, fixtures] = await Promise.all([import("@/lib/db/prisma"), import("./hu-e1.test-fixtures")]);
    t.after(async () => prisma.$disconnect());

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e5-http] current_database() = ${db}`);

    async function loginInterno(usuario: string) {
      const jar = new Jar();
      const { email } = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: usuario }, select: { email: true } });
      const login = await llamar(jar, "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PASSWORD_INTERNO }) });
      assert.equal(login.status, 200, `login ${usuario}`);
      return jar;
    }
    const admin = await loginInterno("admin.ecommerce.seed");
    const operador = await loginInterno("operador.pickpack.seed");

    const rutaVisibilidad = (id: string) => `/api/ecommerce/catalogo/${id}/visibilidad`;
    const rutaBaja = (id: string) => `/api/ecommerce/catalogo/${id}/baja`;

    await t.test("401 sin sesión y 403 sin ecommerce:gestionar_catalogo (Operador de Pick & Pack)", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 1 });
      for (const [path, body] of [
        [rutaVisibilidad(a.productoWebId), { visibilidad_web: false }],
        [rutaBaja(a.productoWebId), { deletion_reason: "Prueba de permisos" }],
      ] as const) {
        const sinSesion = await patch(new Jar(), path, body);
        assert.equal(sinSesion.status, 401, `${path} sin sesión`);
        assert.equal(sinSesion.body.error.code, "UNAUTHORIZED");
        const sinPermiso = await patch(operador, path, body);
        assert.equal(sinPermiso.status, 403, `${path} operador`);
        assert.equal(sinPermiso.body.error.code, "FORBIDDEN");
      }
      const intacto = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(intacto.visibilidad_web, true);
      assert.equal(intacto.is_active, true);
    });

    await t.test("pantalla /ecommerce/catalogo: el admin la ve; el operador es redirigido a /no-autorizado", async () => {
      const pagina = await llamar(admin, "/ecommerce/catalogo");
      assert.equal(pagina.status, 200);
      const sinPermiso = await llamar(operador, "/ecommerce/catalogo");
      assert.ok([307, 308].includes(sinPermiso.status), String(sinPermiso.status));
      assert.match(sinPermiso.response.headers.get("location") ?? "", /\/no-autorizado/);
      const sinSesion = await llamar(new Jar(), "/ecommerce/catalogo");
      assert.ok([307, 308].includes(sinSesion.status), String(sinSesion.status));
      assert.match(sinSesion.response.headers.get("location") ?? "", /\/login/);
    });

    await t.test("400 VALIDATION_ERROR: id mal formado, body inválido, cuerpo raíz inválido y motivo de baja vacío", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 1 });
      const casos: [string, unknown][] = [
        [rutaVisibilidad("no-es-uuid"), { visibilidad_web: false }],
        [rutaBaja("no-es-uuid"), { deletion_reason: "Motivo" }],
        [rutaVisibilidad(a.productoWebId), { visibilidad_web: "false" }],
        [rutaVisibilidad(a.productoWebId), {}],
        [rutaVisibilidad(a.productoWebId), { visibilidad_web: false, motivo: "   " }],
        [rutaVisibilidad(a.productoWebId), "null"],
        [rutaVisibilidad(a.productoWebId), "[]"],
        [rutaVisibilidad(a.productoWebId), "esto no es json"],
        [rutaBaja(a.productoWebId), { deletion_reason: "   " }],
        [rutaBaja(a.productoWebId), {}],
        [rutaBaja(a.productoWebId), "null"],
        [rutaBaja(a.productoWebId), "[1]"],
      ];
      for (const [path, body] of casos) {
        const r = await patch(admin, path, body);
        assert.equal(r.status, 400, `${path} ${JSON.stringify(body)}`);
        assert.equal(r.body.data, null);
        assert.equal(r.body.error.code, "VALIDATION_ERROR");
        assert.equal(typeof r.body.error.message, "string");
      }
      const raiz = await patch(admin, rutaVisibilidad(a.productoWebId), "null");
      assert.equal(raiz.body.error.message, "El cuerpo debe ser un objeto JSON");
      const vacio = await patch(admin, rutaBaja(a.productoWebId), { deletion_reason: "   " });
      assert.equal(vacio.body.error.message, "El motivo de baja es obligatorio");
      const intacto = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(intacto.visibilidad_web, true);
      assert.equal(intacto.is_active, true);
    });

    await t.test("404 PRODUCTO_WEB_NO_ENCONTRADO con un id inexistente", async () => {
      const id = randomUUID();
      for (const [path, body] of [
        [rutaVisibilidad(id), { visibilidad_web: false }],
        [rutaBaja(id), { deletion_reason: "Motivo" }],
      ] as const) {
        const r = await patch(admin, path, body);
        assert.equal(r.status, 404, path);
        assert.deepEqual(r.body.data, null);
        assert.equal(r.body.error.code, "PRODUCTO_WEB_NO_ENCONTRADO");
      }
    });

    await t.test("200 — ocultar/mostrar con el shape de la spec; la tienda deja de mostrarlo; el actor sale de la sesión", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 2 });
      assert.equal((await llamar(new Jar(), `/api/tienda/catalogo/${a.productoWebId}`)).status, 200);

      // Body estricto: intentar imponer otro actor es 400 y no cambia nada.
      const conActor = await patch(admin, rutaVisibilidad(a.productoWebId), {
        visibilidad_web: false,
        actor_id: "00000000-0000-4000-8000-000000000001",
      });
      assert.equal(conActor.status, 400);
      assert.equal(conActor.body.error.code, "VALIDATION_ERROR");
      assert.equal(conActor.body.error.message, "El cuerpo contiene campos no permitidos");
      assert.equal((await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } })).visibilidad_web, true);

      const oculto = await patch(admin, rutaVisibilidad(a.productoWebId), { visibilidad_web: false, motivo: "Fin de temporada" });
      assert.equal(oculto.status, 200);
      assert.deepEqual(oculto.body, { data: { producto_web_id: a.productoWebId, visibilidad_web: false }, error: null });
      assert.equal((await llamar(new Jar(), `/api/tienda/catalogo/${a.productoWebId}`)).status, 404);

      // D2: repetir el valor actual es 200 con el estado actual.
      const repetido = await patch(admin, rutaVisibilidad(a.productoWebId), { visibilidad_web: false });
      assert.deepEqual(repetido.body, { data: { producto_web_id: a.productoWebId, visibilidad_web: false }, error: null });

      const visible = await patch(admin, rutaVisibilidad(a.productoWebId), { visibilidad_web: true });
      assert.deepEqual(visible.body, { data: { producto_web_id: a.productoWebId, visibilidad_web: true }, error: null });
      assert.equal((await llamar(new Jar(), `/api/tienda/catalogo/${a.productoWebId}`)).status, 200);

      let asientos: { usuario_id: string | null; accion: string }[] = [];
      for (let i = 0; i < 40 && asientos.length < 2; i++) {
        asientos = await prisma.auditLog.findMany({
          where: { tabla_afectada: "contenidos_producto_web", registro_id: a.productoWebId },
          select: { usuario_id: true, accion: true },
        });
        if (asientos.length < 2) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(asientos.length, 2, "dos cambios reales, el repetido no audita");
      assert.ok(asientos.every((x) => x.usuario_id === USUARIO_ADMIN_ECOMMERCE_SEED_ID && x.accion === "ecommerce:visibilidad_web_cambiada"));
    });

    await t.test("200 — baja lógica con el shape del contrato; la segunda baja es 404 y la fila sigue existiendo", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 2 });
      const conActor = await patch(admin, rutaBaja(a.productoWebId), { deletion_reason: "Discontinuado", deleted_by: "otro" });
      assert.equal(conActor.status, 400, "deleted_by en el body es 400");
      assert.equal(conActor.body.error.message, "El cuerpo contiene campos no permitidos");
      assert.equal((await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } })).is_active, true);

      const r = await patch(admin, rutaBaja(a.productoWebId), { deletion_reason: "  Discontinuado en la web  " });
      assert.equal(r.status, 200);
      assert.equal(r.body.error, null);
      assert.equal(r.body.data.producto_web_id, a.productoWebId);
      assert.equal(r.body.data.is_active, false);
      assert.match(r.body.data.deleted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const fila = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: a.productoWebId } });
      assert.equal(fila.is_active, false);
      assert.equal(fila.deleted_by, USUARIO_ADMIN_ECOMMERCE_SEED_ID, "el actor sale de la sesión");
      assert.equal(fila.deletion_reason, "Discontinuado en la web");
      assert.equal(fila.visibilidad_web, false);
      assert.equal(fila.deleted_at?.toISOString(), r.body.data.deleted_at);

      const otra = await patch(admin, rutaBaja(a.productoWebId), { deletion_reason: "Otra vez" });
      assert.equal(otra.status, 404);
      assert.equal(otra.body.error.code, "PRODUCTO_WEB_NO_ENCONTRADO");
      const toggle = await patch(admin, rutaVisibilidad(a.productoWebId), { visibilidad_web: true });
      assert.equal(toggle.status, 404, "D3: dado de baja no es operable");
      assert.equal(await prisma.productoWebContenido.count({ where: { id: a.productoWebId } }), 1);
    });

    await t.test("cron check-pruebas-vencidas: misma autenticación y status, con el bloque de carritos", async () => {
      const sinAuth = await llamar(new Jar(), "/api/cron/check-pruebas-vencidas", { method: "POST" });
      assert.equal(sinAuth.status, 401);
      const malAuth = await llamar(new Jar(), "/api/cron/check-pruebas-vencidas", {
        method: "POST",
        headers: { authorization: "Bearer incorrecto" },
      });
      assert.equal(malAuth.status, 401);

      // Un carrito de visitante envejecido para que el bloque reporte una baja.
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 2 });
      const visitante = new Jar();
      const agregado = await llamar(visitante, "/api/tienda/carrito/items", {
        method: "POST",
        body: JSON.stringify({ variante_sku_id: a.varianteId, cantidad: 1 }),
      });
      assert.equal(agregado.status, 201);
      const carritoId = agregado.body.data.carrito_id as string;
      await prisma.carritoWeb.update({ where: { id: carritoId }, data: { updated_at: new Date(Date.now() - 10 * 86_400_000) } });

      const ok = await llamar(new Jar(), "/api/cron/check-pruebas-vencidas", {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.ok, true);
      assert.equal(typeof ok.body.total_reservas_liberadas, "number");
      assert.equal(ok.body.mantenimiento_cupones.ok, true);
      assert.equal(ok.body.mantenimiento_carritos.ok, true);
      assert.ok(ok.body.mantenimiento_carritos.total_desactivados >= 1);
      const fila = await prisma.carritoWeb.findUniqueOrThrow({ where: { id: carritoId } });
      assert.equal(fila.is_active, false);
      assert.equal(fila.deletion_reason, "ABANDONADO");

      // El visitante con esa cookie ve un carrito vacío (D18, por HTTP).
      const vista = await llamar(visitante, "/api/tienda/carrito");
      assert.equal(vista.status, 200);
      assert.equal(vista.body.data.items.length, 0);
    });
  },
);
