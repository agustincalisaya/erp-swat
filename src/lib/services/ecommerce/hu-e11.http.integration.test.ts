import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { imagenMinima, jpgDeTamano, textoComoImagen } from "./hu-e11.test-fixtures.ts";

/**
 * HU-E11 — Nivel 2 HTTP: alta/edición de contenido, fotos por multipart REAL,
 * ruta pública de fotos (incluido path traversal) y listado de la tienda,
 * contra un servidor `next dev` APARTE apuntando a la base de test y con
 * `CATALOGO_FOTOS_DIR` en un directorio temporal FUERA del repo. Las dos
 * variables deben apuntar a la MISMA base.
 *
 *   HU_E11_INTEGRATION_BASE_URL=http://localhost:3111 HU_E11_INTEGRATION_DATABASE_URL=$TEST_DB \
 *   npm run test:integration:e11-http
 *
 * Imágenes mínimas válidas generadas en el test. Nunca se borra nada.
 */

const BASE_URL = process.env.HU_E11_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E11_INTEGRATION_DATABASE_URL;
const PASSWORD_INTERNO = "abc123456789";

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

async function llamar(jar: Jar, path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...resto } = init;
  const headers: Record<string, string> = { cookie: jar.header(), ...((resto.headers as Record<string, string>) ?? {}) };
  if (json !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${BASE_URL}${path}`, {
    ...resto,
    redirect: "manual",
    headers,
    body: json !== undefined ? (typeof json === "string" ? json : JSON.stringify(json)) : resto.body,
  });
  jar.absorber(response);
  const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
  return { status: response.status, body, response };
}

function multipart(campos: Record<string, Uint8Array<ArrayBuffer> | string>, nombreArchivo = "foto.jpg"): FormData {
  const form = new FormData();
  for (const [clave, valor] of Object.entries(campos)) {
    if (typeof valor === "string") form.append(clave, valor);
    else form.append(clave, new Blob([valor], { type: "image/jpeg" }), nombreArchivo);
  }
  return form;
}

test(
  "HU-E11 HTTP — contenido, fotos (multipart), ruta pública de fotos y listado de la tienda",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 600_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const [{ prisma }, fixtures] = await Promise.all([import("@/lib/db/prisma"), import("./hu-e1.test-fixtures")]);
    t.after(async () => prisma.$disconnect());

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e11-http] current_database() = ${db}`);

    async function loginInterno(usuario: string) {
      const jar = new Jar();
      const { email } = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: usuario }, select: { email: true } });
      const login = await llamar(jar, "/api/auth/login", { method: "POST", json: { email, password: PASSWORD_INTERNO } });
      assert.equal(login.status, 200, `login ${usuario}`);
      return jar;
    }
    const admin = await loginInterno("admin.ecommerce.seed");
    const operador = await loginInterno("operador.pickpack.seed");
    const anonimo = new Jar();

    async function crearMaestro() {
      const s = randomUUID().slice(0, 8).toUpperCase();
      return prisma.productoMaestro.create({
        data: {
          codigo_producto: "E11HTTP",
          nombre: `Producto HU-E11 HTTP ${s}`,
          rubro: "Indumentaria",
          categoria: `Test HU-E11 HTTP ${s}`,
          unidad_medida: "UNIDAD",
          costo_estandar_referencia: 1000,
        },
      });
    }
    async function crearContenido() {
      const maestro = await crearMaestro();
      const r = await llamar(admin, "/api/ecommerce/catalogo", {
        method: "POST",
        json: { producto_maestro_id: maestro.id, titulo_comercial: "Contenido HTTP", descripcion: "Descripción HTTP" },
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.data as { producto_web_id: string; producto_maestro_id: string };
    }
    const rutaFotos = (id: string) => `/api/ecommerce/catalogo/${id}/fotos`;
    const subir = (jar: Jar, id: string, campos: Record<string, Uint8Array<ArrayBuffer> | string>) =>
      llamar(jar, rutaFotos(id), { method: "POST", body: multipart(campos) });

    await t.test("401 sin sesión y 403 sin ecommerce:gestionar_catalogo en las cuatro rutas del backoffice", async () => {
      const c = await crearContenido();
      const foto = await subir(admin, c.producto_web_id, { archivo: imagenMinima("JPG") });
      assert.equal(foto.status, 201);
      const maestro = await crearMaestro();
      const casos: [string, RequestInit & { json?: unknown }][] = [
        ["/api/ecommerce/catalogo", { method: "POST", json: { producto_maestro_id: maestro.id, titulo_comercial: "X", descripcion: "Y" } }],
        [`/api/ecommerce/catalogo/${c.producto_web_id}`, { method: "PATCH", json: { titulo_comercial: "X" } }],
        [`/api/ecommerce/catalogo/${c.producto_web_id}/fotos/${foto.body.data.foto_id}`, { method: "PATCH", json: { deletion_reason: "X" } }],
      ];
      for (const [path, init] of casos) {
        const sinSesion = await llamar(new Jar(), path, init);
        assert.equal(sinSesion.status, 401, `${path} sin sesión`);
        assert.equal(sinSesion.body.error.code, "UNAUTHORIZED");
        const sinPermiso = await llamar(operador, path, init);
        assert.equal(sinPermiso.status, 403, `${path} operador`);
        assert.equal(sinPermiso.body.error.code, "FORBIDDEN");
      }
      const subidaSinSesion = await subir(new Jar(), c.producto_web_id, { archivo: imagenMinima("JPG") });
      assert.equal(subidaSinSesion.status, 401);
      const subidaSinPermiso = await subir(operador, c.producto_web_id, { archivo: imagenMinima("JPG") });
      assert.equal(subidaSinPermiso.status, 403);
      assert.equal(await prisma.productoWebContenido.count({ where: { producto_maestro_id: maestro.id } }), 0);
      assert.equal(await prisma.productoWebFoto.count({ where: { producto_web_contenido_id: c.producto_web_id } }), 1);
    });

    await t.test("POST contenido: 201 con el contrato exacto; 400; 404 PRODUCTO_MAESTRO_NO_ENCONTRADO; 409", async () => {
      const maestro = await crearMaestro();
      const ok = await llamar(admin, "/api/ecommerce/catalogo", {
        method: "POST",
        json: { producto_maestro_id: maestro.id, titulo_comercial: "  Nuevo  ", descripcion: " Desc " },
      });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.error, null);
      assert.deepEqual(Object.keys(ok.body.data).sort(), ["producto_maestro_id", "producto_web_id", "visibilidad_web"]);
      assert.equal(ok.body.data.visibilidad_web, false);
      const fila = await prisma.productoWebContenido.findUniqueOrThrow({ where: { id: ok.body.data.producto_web_id } });
      assert.equal(fila.titulo_comercial, "Nuevo");

      const repetido = await llamar(admin, "/api/ecommerce/catalogo", {
        method: "POST",
        json: { producto_maestro_id: maestro.id, titulo_comercial: "Otro", descripcion: "Otra" },
      });
      assert.equal(repetido.status, 409);
      assert.equal(repetido.body.error.code, "CONTENIDO_WEB_EXISTENTE");

      const inexistente = await llamar(admin, "/api/ecommerce/catalogo", {
        method: "POST",
        json: { producto_maestro_id: randomUUID(), titulo_comercial: "X", descripcion: "Y" },
      });
      assert.equal(inexistente.status, 404);
      assert.equal(inexistente.body.error.code, "PRODUCTO_MAESTRO_NO_ENCONTRADO");

      const otro = await crearMaestro();
      for (const cuerpo of [
        { producto_maestro_id: "no-uuid", titulo_comercial: "X", descripcion: "Y" },
        { producto_maestro_id: otro.id, titulo_comercial: "   ", descripcion: "Y" },
        { producto_maestro_id: otro.id, titulo_comercial: "X", descripcion: "" },
        { producto_maestro_id: otro.id, titulo_comercial: "X", descripcion: "Y", visibilidad_web: true },
        "null",
        "[]",
        "no es json",
      ]) {
        const r = await llamar(admin, "/api/ecommerce/catalogo", { method: "POST", json: cuerpo });
        assert.equal(r.status, 400, JSON.stringify(cuerpo));
        assert.equal(r.body.error.code, "VALIDATION_ERROR");
      }
      const extra = await llamar(admin, "/api/ecommerce/catalogo", {
        method: "POST",
        json: { producto_maestro_id: otro.id, titulo_comercial: "X", descripcion: "Y", actor_id: "x" },
      });
      assert.equal(extra.body.error.message, "El cuerpo contiene campos no permitidos");
      assert.equal(await prisma.productoWebContenido.count({ where: { producto_maestro_id: otro.id } }), 0);
    });

    await t.test("PATCH contenido: 200 con el contenido actualizado; 400; 404 (inexistente y dado de baja)", async () => {
      const c = await crearContenido();
      const ruta = `/api/ecommerce/catalogo/${c.producto_web_id}`;
      const ok = await llamar(admin, ruta, { method: "PATCH", json: { descripcion: "Nueva descripción" } });
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body.data, {
        producto_web_id: c.producto_web_id,
        titulo_comercial: "Contenido HTTP",
        descripcion: "Nueva descripción",
        visibilidad_web: false,
      });
      for (const cuerpo of [{}, { titulo_comercial: "  " }, { visibilidad_web: true }, { titulo_comercial: "X", deleted_at: null }, "null"]) {
        const r = await llamar(admin, ruta, { method: "PATCH", json: cuerpo });
        assert.equal(r.status, 400, JSON.stringify(cuerpo));
        assert.equal(r.body.error.code, "VALIDATION_ERROR");
      }
      const idMalo = await llamar(admin, "/api/ecommerce/catalogo/no-uuid", { method: "PATCH", json: { descripcion: "X" } });
      assert.equal(idMalo.status, 400);
      const inexistente = await llamar(admin, `/api/ecommerce/catalogo/${randomUUID()}`, { method: "PATCH", json: { descripcion: "X" } });
      assert.equal(inexistente.status, 404);
      assert.equal(inexistente.body.error.code, "PRODUCTO_WEB_NO_ENCONTRADO");
      const baja = await llamar(admin, `${ruta}/baja`, { method: "PATCH", json: { deletion_reason: "Baja HTTP" } });
      assert.equal(baja.status, 200);
      const deBaja = await llamar(admin, ruta, { method: "PATCH", json: { descripcion: "X" } });
      assert.equal(deBaja.status, 404);
    });

    await t.test("POST fotos multipart: 201 y GET público con Content-Type correcto, cache inmutable y sin sesión", async () => {
      const c = await crearContenido();
      for (const [formato, contentType] of [["JPG", "image/jpeg"], ["PNG", "image/png"], ["WEBP", "image/webp"]] as const) {
        const r = await subir(admin, c.producto_web_id, { archivo: imagenMinima(formato) });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual(Object.keys(r.body.data).sort(), ["deleted_at", "es_principal", "foto_id", "is_active", "orden", "producto_web_id", "url"]);
        assert.match(r.body.data.url, /^\/api\/tienda\/fotos\/[0-9a-f-]{36}\.(jpg|png|webp)$/);
        const imagen = await fetch(`${BASE_URL}${r.body.data.url}`);
        assert.equal(imagen.status, 200);
        assert.equal(imagen.headers.get("content-type"), contentType);
        assert.equal(imagen.headers.get("cache-control"), "public, max-age=31536000, immutable");
        assert.equal(imagen.headers.get("x-content-type-options"), "nosniff");
        assert.deepEqual(new Uint8Array(await imagen.arrayBuffer()), imagenMinima(formato));
      }
      // El nombre del archivo del cliente no se usa: la extensión sale del formato detectado.
      const png = await llamar(admin, rutaFotos(c.producto_web_id), {
        method: "POST",
        body: multipart({ archivo: imagenMinima("PNG"), es_principal: "true" }, "../../malicioso.jpg"),
      });
      assert.equal(png.status, 201);
      assert.match(png.body.data.url, /\.png$/);
      assert.equal(png.body.data.es_principal, true);
      const principales = await prisma.productoWebFoto.count({
        where: { producto_web_contenido_id: c.producto_web_id, is_active: true, es_principal: true },
      });
      assert.equal(principales, 1);
    });

    await t.test("POST fotos: 400 (sin archivo, no multipart, campo extra, es_principal inválido, archivo repetido, id malo)", async () => {
      const c = await crearContenido();
      const casos: [string, RequestInit & { json?: unknown }][] = [
        ["sin archivo", { method: "POST", body: multipart({ es_principal: "true" }) }],
        ["archivo de texto", { method: "POST", body: multipart({ archivo: "no soy un archivo" }) }],
        ["JSON en vez de multipart", { method: "POST", json: { url: "https://x.com/a.jpg" } }],
        ["campo extra", { method: "POST", body: multipart({ archivo: imagenMinima("JPG"), url: "/x" }) }],
        ["es_principal inválido", { method: "POST", body: multipart({ archivo: imagenMinima("JPG"), es_principal: "si" }) }],
      ];
      for (const [nombre, init] of casos) {
        const r = await llamar(admin, rutaFotos(c.producto_web_id), init);
        assert.equal(r.status, 400, nombre);
        assert.equal(r.body.error.code, "VALIDATION_ERROR", nombre);
      }
      const repetido = new FormData();
      repetido.append("archivo", new Blob([imagenMinima("JPG")]), "a.jpg");
      repetido.append("archivo", new Blob([imagenMinima("JPG")]), "b.jpg");
      const r = await llamar(admin, rutaFotos(c.producto_web_id), { method: "POST", body: repetido });
      assert.equal(r.status, 400);
      const idMalo = await subir(admin, "no-uuid", { archivo: imagenMinima("JPG") });
      assert.equal(idMalo.status, 400);
      assert.equal(await prisma.productoWebFoto.count({ where: { producto_web_contenido_id: c.producto_web_id } }), 0);
    });

    await t.test("POST fotos: 422 formato falso, vacía, demasiado grande (por tamaño real, por Content-Length y por stream)", async () => {
      const c = await crearContenido();
      const MB = 1024 * 1024;
      const falso = await subir(admin, c.producto_web_id, { archivo: textoComoImagen() });
      assert.equal(falso.status, 422);
      assert.equal(falso.body.error.code, "FORMATO_IMAGEN_NO_ADMITIDO");
      const gif = await subir(admin, c.producto_web_id, { archivo: new TextEncoder().encode("GIF89a\x01\x00\x01\x00") });
      assert.equal(gif.body.error.code, "FORMATO_IMAGEN_NO_ADMITIDO");
      const vacia = await subir(admin, c.producto_web_id, { archivo: new Uint8Array() });
      assert.equal(vacia.status, 422);
      assert.equal(vacia.body.error.code, "ARCHIVO_VACIO");
      // Un byte sobre el máximo: pasa el tope del cuerpo (máximo + 64 KB) y lo rechaza el tamaño real.
      const grande = await subir(admin, c.producto_web_id, { archivo: jpgDeTamano(5 * MB + 1) });
      assert.equal(grande.status, 422);
      assert.equal(grande.body.error.code, "ARCHIVO_DEMASIADO_GRANDE");
      // Muy grande: lo corta el Content-Length antes de parsear.
      const enorme = await subir(admin, c.producto_web_id, { archivo: jpgDeTamano(6 * MB) });
      assert.equal(enorme.status, 422);
      assert.equal(enorme.body.error.code, "ARCHIVO_DEMASIADO_GRANDE");
      // Sin Content-Length (chunked): lo corta la lectura del stream con tope.
      const cuerpo = new Response(multipart({ archivo: jpgDeTamano(6 * MB) }));
      const tipo = cuerpo.headers.get("content-type")!;
      const chunked = await fetch(`${BASE_URL}${rutaFotos(c.producto_web_id)}`, {
        method: "POST",
        headers: { cookie: admin.header(), "content-type": tipo },
        body: cuerpo.body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      assert.equal(chunked.status, 422);
      assert.equal((await chunked.json()).error.code, "ARCHIVO_DEMASIADO_GRANDE");
      // En el límite exacto: se admite.
      const enLimite = await subir(admin, c.producto_web_id, { archivo: jpgDeTamano(5 * MB) });
      assert.equal(enLimite.status, 201);
      assert.equal(await prisma.productoWebFoto.count({ where: { producto_web_contenido_id: c.producto_web_id } }), 1);
    });

    await t.test("POST fotos: 404 contenido inexistente; 409 LIMITE_FOTOS_ALCANZADO al superar N", async () => {
      const inexistente = await subir(admin, randomUUID(), { archivo: imagenMinima("JPG") });
      assert.equal(inexistente.status, 404);
      assert.equal(inexistente.body.error.code, "PRODUCTO_WEB_NO_ENCONTRADO");
      const c = await crearContenido();
      for (let i = 0; i < 8; i++) assert.equal((await subir(admin, c.producto_web_id, { archivo: imagenMinima("PNG") })).status, 201);
      const novena = await subir(admin, c.producto_web_id, { archivo: imagenMinima("PNG") });
      assert.equal(novena.status, 409);
      assert.equal(novena.body.error.code, "LIMITE_FOTOS_ALCANZADO");
    });

    await t.test("PATCH foto: principal 200, baja 200 (sigue sirviéndose), 400 combinaciones, 404 ajena / de baja", async () => {
      const c = await crearContenido();
      const otro = await crearContenido();
      const a = (await subir(admin, c.producto_web_id, { archivo: imagenMinima("JPG") })).body.data;
      const b = (await subir(admin, c.producto_web_id, { archivo: imagenMinima("PNG") })).body.data;
      const ruta = (fotoId: string, contenido = c.producto_web_id) => `/api/ecommerce/catalogo/${contenido}/fotos/${fotoId}`;

      const principal = await llamar(admin, ruta(b.foto_id), { method: "PATCH", json: { es_principal: true } });
      assert.equal(principal.status, 200);
      assert.equal(principal.body.data.es_principal, true);

      for (const cuerpo of [{}, { es_principal: true, deletion_reason: "x" }, { es_principal: false }, { deletion_reason: "  " }, { es_principal: true, orden: 1 }, "null"]) {
        const r = await llamar(admin, ruta(a.foto_id), { method: "PATCH", json: cuerpo });
        assert.equal(r.status, 400, JSON.stringify(cuerpo));
        assert.equal(r.body.error.code, "VALIDATION_ERROR");
      }
      assert.equal((await llamar(admin, `/api/ecommerce/catalogo/${c.producto_web_id}/fotos/no-uuid`, { method: "PATCH", json: { es_principal: true } })).status, 400);

      const ajena = await llamar(admin, ruta(a.foto_id, otro.producto_web_id), { method: "PATCH", json: { es_principal: true } });
      assert.equal(ajena.status, 404);
      assert.equal(ajena.body.error.code, "FOTO_WEB_NO_ENCONTRADA");

      const baja = await llamar(admin, ruta(b.foto_id), { method: "PATCH", json: { deletion_reason: "Ya no va" } });
      assert.equal(baja.status, 200);
      assert.equal(baja.body.data.is_active, false);
      assert.ok(baja.body.data.deleted_at);
      const otraVez = await llamar(admin, ruta(b.foto_id), { method: "PATCH", json: { deletion_reason: "Otra vez" } });
      assert.equal(otraVez.status, 404);
      assert.equal(otraVez.body.error.code, "FOTO_WEB_NO_ENCONTRADA");
      const promovida = await prisma.productoWebFoto.findUniqueOrThrow({ where: { id: a.foto_id } });
      assert.equal(promovida.es_principal, true);
      // D24: la foto dada de baja se sigue sirviendo; el archivo no se borró.
      assert.equal((await fetch(`${BASE_URL}${b.url}`)).status, 200);
    });

    await t.test("GET público de fotos: path traversal y nombres no generados por el servidor → rechazados", async () => {
      const c = await crearContenido();
      const foto = (await subir(admin, c.producto_web_id, { archivo: imagenMinima("JPG") })).body.data;
      const nombre = foto.url.split("/").pop()!;
      for (const intento of [
        "..%2F..%2F.env",
        "%2e%2e%2f%2e%2e%2fpackage.json",
        "..%5C..%5C.env",
        `..%2F${nombre}`,
        `${nombre}%2F..%2F..%2F.env`,
        "%2Fetc%2Fpasswd",
        nombre.toUpperCase(),
        nombre.replace(".jpg", ".svg"),
        `${randomUUID()}.jpg`,
        "package.json",
      ]) {
        const r = await fetch(`${BASE_URL}/api/tienda/fotos/${intento}`);
        assert.ok([400, 404].includes(r.status), `${intento} → ${r.status}`);
        assert.notEqual(r.headers.get("content-type")?.startsWith("image/"), true, intento);
        const texto = await r.text();
        assert.equal(/DATABASE_URL|JWT_SECRET|"dependencies"/.test(texto), false, intento);
      }
      // Rutas no codificadas: fetch normaliza `..`, nunca sale de /api/tienda/fotos.
      const crudo = await fetch(`${BASE_URL}/api/tienda/fotos/../../../.env`);
      assert.notEqual(crudo.status, 200);
      assert.equal((await fetch(`${BASE_URL}/api/tienda/fotos/${nombre}`)).status, 200, "la válida sí");
    });

    await t.test("GET /api/tienda/catalogo: filtros, orden, valores disponibles, 400 y parámetros extra ignorados", async () => {
      const s = randomUUID().slice(0, 8).toUpperCase();
      const categoria = `Test HU-E11 HTTP CAT ${s}`;
      const crear = async (titulo: string, talle: string, precio: number, offsetMs: number) => {
        const a = await fixtures.crearArticulo(prisma, { stockShowroom: 2, precio });
        await prisma.productoMaestro.update({ where: { id: a.productoMaestroId }, data: { categoria } });
        await prisma.varianteSKU.update({ where: { id: a.varianteId }, data: { talle } });
        await prisma.productoWebContenido.update({
          where: { id: a.productoWebId },
          data: { titulo_comercial: titulo, created_at: new Date(Date.now() - 60_000 + offsetMs) },
        });
        return a.productoWebId;
      };
      const caro = await crear("Caro", `T1-${s}`, 9000, 0);
      const barato = await crear("Barato", `T2-${s}`, 1000, 1000);
      const q = (params: Record<string, string>) => `/api/tienda/catalogo?${new URLSearchParams({ categoria, ...params })}`;

      const novedad = await llamar(anonimo, q({}));
      assert.equal(novedad.status, 200);
      assert.deepEqual(novedad.body.data.items.map((i: { producto_web_id: string }) => i.producto_web_id), [barato, caro]);
      assert.deepEqual(Object.keys(novedad.body.data).sort(), ["filtros", "items", "paginacion"]);
      assert.deepEqual(Object.keys(novedad.body.data.filtros).sort(), ["categorias", "colores", "generos", "modelos", "talles"]);
      assert.ok(novedad.body.data.filtros.talles.includes(`T1-${s}`));
      assert.ok(novedad.body.data.filtros.categorias.includes(categoria));

      const desc = await llamar(anonimo, q({ orden: "precio_desc", utm_source: "ignorado" }));
      assert.equal(desc.status, 200);
      assert.deepEqual(desc.body.data.items.map((i: { producto_web_id: string }) => i.producto_web_id), [caro, barato]);

      const talle = await llamar(anonimo, q({ talle: `T2-${s}` }));
      assert.deepEqual(talle.body.data.items.map((i: { producto_web_id: string }) => i.producto_web_id), [barato]);
      const vacio = await llamar(anonimo, q({ talle: "no-existe", color: "Negro" }));
      assert.equal(vacio.status, 200);
      assert.deepEqual(vacio.body.data.items, []);
      const pagina = await llamar(anonimo, q({ page: "2", page_size: "1" }));
      assert.deepEqual(pagina.body.data.paginacion, { total: 2, pagina_actual: 2, total_paginas: 2, por_pagina: 1 });

      for (const malo of [{ orden: "barato" }, { page: "0" }, { page_size: "100" }, { modelo: "x".repeat(101) }] as Record<string, string>[]) {
        const r = await llamar(anonimo, q(malo));
        assert.equal(r.status, 400, JSON.stringify(malo));
        assert.equal(r.body.error.code, "VALIDATION_ERROR");
      }
      // La página de la tienda renderiza con filtros y orden.
      const html = await fetch(`${BASE_URL}/tienda/catalogo?${new URLSearchParams({ categoria, orden: "precio_asc" })}`);
      assert.equal(html.status, 200);
      const texto = await html.text();
      assert.ok(texto.includes("Barato") && texto.includes("Caro"));
      assert.ok(texto.indexOf("Barato") < texto.indexOf("Caro"), "precio ascendente");
    });

    await t.test("pantalla /ecommerce/catalogo: el admin la ve con el alta; el operador es redirigido", async () => {
      const pagina = await llamar(admin, "/ecommerce/catalogo");
      assert.equal(pagina.status, 200);
      const sinPermiso = await llamar(operador, "/ecommerce/catalogo");
      assert.ok([307, 308].includes(sinPermiso.status), String(sinPermiso.status));
      assert.match(sinPermiso.response.headers.get("location") ?? "", /\/no-autorizado/);
    });
  },
);
