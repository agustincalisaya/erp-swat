import assert from "node:assert/strict";
import test from "node:test";
const BASE_URL = process.env.HU_E8_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E8_INTEGRATION_DATABASE_URL;
const PASSWORD = "password-segura";

class Jar {
  private readonly cookies = new Map<string, string>();
  absorber(response: Response) { for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"); const [name, ...rest] = pair.split("="); const value = rest.join("="); if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name.trim()); else this.cookies.set(name.trim(), value); } }
  get(name: string) { return this.cookies.get(name); }
  set(name: string, value: string) { this.cookies.set(name, value); }
  header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "); }
}
async function llamar(jar: Jar, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, { ...init, redirect: "manual", headers: { "content-type": "application/json", cookie: jar.header(), ...(init.headers ?? {}) } });
  jar.absorber(response);
  const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
  return { status: response.status, body, response };
}
const dni = () => String(30_000_000 + Math.floor(Math.random() * 9_000_000));
const email = (prefix: string) => `${prefix}-${crypto.randomUUID()}@example.test`;

test("HU-E8 HTTP — rutas, permisos, cookies y aislamiento", { skip: !BASE_URL || !DATABASE_URL, timeout: 180_000 }, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, { hashPassword }, fixtures, servicio] = await Promise.all([
    import("@/lib/db/prisma"), import("@/lib/auth/password-hash-core"), import("./hu-e1.test-fixtures"), import("./cuenta-cliente-web.service"),
  ]);
  t.after(async () => prisma.$disconnect());
  const { hash } = await hashPassword(PASSWORD);

  async function crearCuenta(pendiente = false) {
    const cliente = await prisma.cliente.create({ data: { dni: dni(), nombre: "HTTP E8", telefono: "3874222222", email: email("cliente") } });
    const cuenta = await prisma.cuentaClienteWeb.create({ data: { cliente_id: cliente.id, email: email("cuenta"), password_hash: hash, vinculacion_pendiente: pendiente } });
    return { cliente, cuenta };
  }
  async function loginWeb(cuentaEmail: string, password = PASSWORD, jar = new Jar()) {
    const result = await llamar(jar, "/api/tienda/cuenta/login", { method: "POST", body: JSON.stringify({ email: cuentaEmail, password }) });
    return { ...result, jar };
  }
  async function loginInterno(usuario: string) {
    const jar = new Jar();
    const usuarioInterno = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: usuario }, select: { email: true } });
    const result = await llamar(jar, "/api/auth/login", { method: "POST", body: JSON.stringify({ email: usuarioInterno.email, password: "abc123456789" }) });
    assert.equal(result.status, 200); return jar;
  }

  await t.test("registro: 400 inválido, 201 sin cookie y conflictos 409", async () => {
    assert.equal((await llamar(new Jar(), "/api/tienda/cuenta/registro", { method: "POST", body: "{}" })).status, 400);
    const body = { nombre: "Cliente HTTP", dni: dni(), telefono: "3874000000", email: email("registro-http"), password: PASSWORD, acepta_tratamiento: true, acepta_comunicaciones: false };
    const primero = await llamar(new Jar(), "/api/tienda/cuenta/registro", { method: "POST", body: JSON.stringify(body) });
    assert.equal(primero.status, 201); assert.equal(primero.response.headers.get("set-cookie"), null);
    assert.equal((await llamar(new Jar(), "/api/tienda/cuenta/registro", { method: "POST", body: JSON.stringify({ ...body, email: email("otro") }) })).status, 409);
    assert.equal((await llamar(new Jar(), "/api/tienda/cuenta/registro", { method: "POST", body: JSON.stringify({ ...body, dni: dni() }) })).status, 409);
  });

  await t.test("rutas internas: 401 sin sesión, 403 sin permiso y Vendedor autorizado", async () => {
    const cuenta = await crearCuenta(true);
    assert.equal((await llamar(new Jar(), `/api/ecommerce/cuentas-web?dni=${cuenta.cliente.dni}`)).status, 401);
    const auditor = await loginInterno("auditor.seed");
    assert.equal((await llamar(auditor, `/api/ecommerce/cuentas-web?dni=${cuenta.cliente.dni}`)).status, 403);
    const vendedor = await loginInterno("vendedor.seed");
    assert.equal((await llamar(vendedor, `/api/ecommerce/cuentas-web?dni=${cuenta.cliente.dni}`)).status, 200);
    const validada = await llamar(vendedor, `/api/ecommerce/cuentas-web/${cuenta.cuenta.id}/validar-vinculacion`, { method: "POST", body: JSON.stringify({ email_reconocido: true }) });
    assert.equal(validada.status, 200); assert.equal(validada.body.data.vinculacion_pendiente, false);
  });

  await t.test("reasignación HTTP devuelve código y reemplaza acceso", async () => {
    const { cuenta } = await crearCuenta(true); const vendedor = await loginInterno("vendedor.seed"); const titular = email("titular-http");
    const resultados = await Promise.all([0, 1].map(() => llamar(vendedor, `/api/ecommerce/cuentas-web/${cuenta.id}/validar-vinculacion`, { method: "POST", body: JSON.stringify({ email_reconocido: false, email_titular: titular }) })));
    assert.ok(resultados.every((resultado) => resultado.status === 200));
    assert.equal(resultados.filter((resultado) => resultado.body.data.codigo?.length === 8).length, 1);
    assert.equal(resultados.filter((resultado) => !("codigo" in resultado.body.data)).length, 1);
    assert.equal((await loginWeb(cuenta.email)).status, 401);
    assert.equal((await prisma.cuentaClienteWeb.findUniqueOrThrow({ where: { id: cuenta.id } })).email, titular);
  });

  await t.test("pendiente inicia sesión pero usa visitante; checkout/baja 403, páginas redirigen y logout funciona", async () => {
    const { cuenta } = await crearCuenta(true); const login = await loginWeb(cuenta.email); assert.equal(login.status, 200); assert.ok(login.jar.get("swat_tienda_session"));
    assert.equal((await llamar(login.jar, "/api/tienda/checkout", { method: "POST", body: "{}" })).status, 403);
    assert.equal((await llamar(login.jar, "/api/tienda/cuenta/baja", { method: "PATCH", body: JSON.stringify({ motivo: "x", confirmar: true }) })).status, 403);
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 2, precio: 10000 });
    const agregado = await llamar(login.jar, "/api/tienda/carrito/items", { method: "POST", body: JSON.stringify({ variante_sku_id: articulo.varianteId, cantidad: 1 }) });
    assert.equal(agregado.status, 201); assert.ok(login.jar.get("swat_carrito"));
    for (const pagina of ["/tienda/checkout/pendiente", "/tienda/checkout/resultado"]) { const result = await llamar(login.jar, pagina); assert.equal(result.status, 307); assert.equal(result.response.headers.get("location"), "/tienda/cuenta"); }
    assert.equal((await llamar(login.jar, "/tienda/cuenta")).status, 200);
    assert.equal((await llamar(login.jar, "/api/tienda/cuenta/logout", { method: "POST" })).status, 200); assert.equal(login.jar.get("swat_tienda_session"), undefined);
  });

  await t.test("recuperación HTTP: pendiente 409; éxito y segundo uso 422, sin Set-Cookie", async () => {
    const pendiente = await crearCuenta(true); const vendedor = await loginInterno("vendedor.seed");
    assert.equal((await llamar(vendedor, `/api/ecommerce/cuentas-web/${pendiente.cuenta.id}/habilitar-recuperacion`, { method: "POST" })).status, 409);
    const vinculada = await crearCuenta(false);
    const habilitada = await llamar(vendedor, `/api/ecommerce/cuentas-web/${vinculada.cuenta.id}/habilitar-recuperacion`, { method: "POST" });
    assert.equal(habilitada.status, 201);
    const input = { email: vinculada.cuenta.email, codigo: habilitada.body.data.codigo, password: "password-nueva", confirmacion: "password-nueva" };
    const redefinida = await llamar(new Jar(), "/api/tienda/cuenta/redefinir-password", { method: "POST", body: JSON.stringify(input) });
    assert.equal(redefinida.status, 200); assert.equal(redefinida.response.headers.get("set-cookie"), null);
    assert.equal((await llamar(new Jar(), "/api/tienda/cuenta/redefinir-password", { method: "POST", body: JSON.stringify(input) })).status, 422);
  });

  await t.test("baja vinculada limpia cookie, revoca sesión y login", async () => {
    const { cuenta } = await crearCuenta(false); const login = await loginWeb(cuenta.email); assert.equal(login.status, 200);
    const baja = await llamar(login.jar, "/api/tienda/cuenta/baja", { method: "PATCH", body: JSON.stringify({ motivo: "Decisión personal", confirmar: true }) });
    assert.equal(baja.status, 200); assert.equal(login.jar.get("swat_tienda_session"), undefined);
    assert.equal((await loginWeb(cuenta.email)).status, 401);
  });

  await t.test("CA08 — cookies JWT internas/web son incompatibles y tv viejo se rechaza", async () => {
    const { cuenta } = await crearCuenta(false); const web = await loginWeb(cuenta.email); const webToken = web.jar.get("swat_tienda_session"); assert.ok(webToken);
    const interno = await loginInterno("vendedor.seed"); const internoToken = interno.get("swat_session"); assert.ok(internoToken);
    const internoComoWeb = new Jar(); internoComoWeb.set("swat_tienda_session", internoToken!);
    assert.equal((await llamar(internoComoWeb, "/api/tienda/checkout", { method: "POST", body: "{}" })).status, 401);
    const webComoInterno = new Jar(); webComoInterno.set("swat_session", webToken!);
    assert.equal((await llamar(webComoInterno, `/api/ecommerce/cuentas-web?dni=${(await prisma.cliente.findUniqueOrThrow({ where: { id: cuenta.cliente_id } })).dni}`)).status, 401);
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { token_version: { increment: 1 } } });
    assert.equal((await llamar(web.jar, "/api/tienda/checkout", { method: "POST", body: "{}" })).status, 401);
  });

  await t.test("CA09 — pendiente conserva cookie visitante y no fusiona", async () => {
    const { cuenta } = await crearCuenta(true); const jar = new Jar();
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 2, precio: 10000 });
    assert.equal((await llamar(jar, "/api/tienda/carrito/items", { method: "POST", body: JSON.stringify({ variante_sku_id: articulo.varianteId, cantidad: 1 }) })).status, 201);
    const cookieVisitante = jar.get("swat_carrito"); assert.ok(cookieVisitante);
    const result = await loginWeb(cuenta.email, PASSWORD, jar); assert.equal(result.status, 200); assert.equal(result.body.data.carrito_fusionado, false); assert.equal(jar.get("swat_carrito"), cookieVisitante);
  });

  await t.test("redefinición con código incorrecto responde 422", async () => {
    const { cuenta } = await crearCuenta(false); await servicio.habilitarRecuperacionCuentaWeb(cuenta.id, (await prisma.usuario.findFirstOrThrow({ where: { nombre_usuario: "vendedor.seed" } })).id);
    const result = await llamar(new Jar(), "/api/tienda/cuenta/redefinir-password", { method: "POST", body: JSON.stringify({ email: cuenta.email, codigo: "ABCDEFGH", password: "password-nueva", confirmacion: "password-nueva" }) });
    assert.equal(result.status, 422); assert.equal(result.body.error.code, "CODIGO_RECUPERACION_INVALIDO");
  });

  await t.test("§4.3 — mensajes exactos de CUENTA_BLOQUEADA (423) y SESION_CLIENTE_WEB_REQUERIDA (401)", async () => {
    const { cuenta } = await crearCuenta(false);
    await prisma.cuentaClienteWeb.update({ where: { id: cuenta.id }, data: { bloqueada_hasta: new Date(Date.now() + 15 * 60_000) } });
    const bloqueada = await loginWeb(cuenta.email);
    assert.equal(bloqueada.status, 423);
    assert.deepEqual(bloqueada.body.error, { code: "CUENTA_BLOQUEADA", message: "La cuenta está bloqueada temporalmente por intentos fallidos; la recuperación es presencial en sucursal" });
    const sinSesion = await llamar(new Jar(), "/api/tienda/checkout", { method: "POST", body: "{}" });
    assert.equal(sinSesion.status, 401);
    assert.deepEqual(sinSesion.body.error, { code: "SESION_CLIENTE_WEB_REQUERIDA", message: "Debe iniciar sesión para completar la compra" });
    const bajaSinSesion = await llamar(new Jar(), "/api/tienda/cuenta/baja", { method: "PATCH", body: "{}" });
    assert.equal(bajaSinSesion.status, 401);
    assert.deepEqual(bajaSinSesion.body.error, { code: "SESION_CLIENTE_WEB_REQUERIDA", message: "Debe iniciar sesión para continuar" });
  });

  await t.test("§4.3 — configuración ECOMMERCE_CUENTA_WEB_* inválida o ausente: 500 genérico sin nombre de clave", async () => {
    const { cuenta } = await crearCuenta(false);
    const esperado = { status: 500, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá más tarde." } };
    const verificar = async () => {
      const login = await loginWeb(cuenta.email);
      const redefinicion = await llamar(new Jar(), "/api/tienda/cuenta/redefinir-password", { method: "POST", body: JSON.stringify({ email: cuenta.email, codigo: "ABCDEFGH", password: "password-nueva", confirmacion: "password-nueva" }) });
      for (const r of [login, redefinicion]) {
        assert.deepEqual({ status: r.status, error: r.body.error }, esperado);
        assert.doesNotMatch(JSON.stringify(r.body), /ECOMMERCE_CUENTA_WEB/);
      }
    };
    const max = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_CUENTA_WEB_MAX_INTENTOS" } });
    try { await prisma.configuracionSistema.update({ where: { id: max.id }, data: { valor: "0" } }); await verificar(); }
    finally { await prisma.configuracionSistema.update({ where: { id: max.id }, data: { valor: max.valor } }); }
    const bloqueo = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_CUENTA_WEB_BLOQUEO_MINUTOS" } });
    try { await prisma.configuracionSistema.update({ where: { id: bloqueo.id }, data: { clave: `${bloqueo.clave}_TEST_AUSENTE` } }); await verificar(); }
    finally { await prisma.configuracionSistema.update({ where: { id: bloqueo.id }, data: { clave: bloqueo.clave } }); }
    assert.equal((await loginWeb(cuenta.email)).status, 200);
  });

  await t.test("carrito de cuenta pendiente: sin botón de compra, solo aviso con enlace a /tienda/cuenta", async () => {
    const { cuenta } = await crearCuenta(true); const login = await loginWeb(cuenta.email); assert.equal(login.status, 200);
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 2, precio: 10000 });
    assert.equal((await llamar(login.jar, "/api/tienda/carrito/items", { method: "POST", body: JSON.stringify({ variante_sku_id: articulo.varianteId, cantidad: 1 }) })).status, 201);
    const pagina = await llamar(login.jar, "/tienda/carrito"); assert.equal(pagina.status, 200);
    const html = await pagina.response.text();
    assert.match(html, /href="\/tienda\/cuenta"/);
    assert.doesNotMatch(html, /Iniciar compra|Ingresar para comprar/);
  });
});
