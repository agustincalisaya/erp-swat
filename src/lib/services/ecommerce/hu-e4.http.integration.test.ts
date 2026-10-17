import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * HU-E4 — Nivel 2 HTTP: rutas de administración de cupones y checkout con
 * cupón contra un servidor APARTE apuntando a la base de test (mismo
 * procedimiento que `HU1_MODULO_E.md` §9.1). Ambas variables deben apuntar a
 * la MISMA base: el estado se prepara por Prisma y se verifica por HTTP.
 *
 *   HU_E4_INTEGRATION_BASE_URL=http://localhost:3102 HU_E4_INTEGRATION_DATABASE_URL=$TEST_DB \
 *     npm run test:integration:e4-http
 *
 * Nunca se borra nada (Regla N.° 1).
 */

const BASE_URL = process.env.HU_E4_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E4_INTEGRATION_DATABASE_URL;
const PASSWORD_WEB = "password-segura-e4";
const PASSWORD_INTERNO = "abc123456789";
const DIA_MS = 86_400_000;

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

const isoEnDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString();

test("HU-E4 HTTP — administración de cupones y checkout con cupón", { skip: !BASE_URL || !DATABASE_URL, timeout: 300_000 }, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  const [{ prisma }, { hashPassword }, fixtures] = await Promise.all([
    import("@/lib/db/prisma"),
    import("@/lib/auth/password-hash-core"),
    import("./hu-e1.test-fixtures"),
  ]);
  t.after(async () => prisma.$disconnect());
  const { hash } = await hashPassword(PASSWORD_WEB);

  async function loginInterno(usuario: string) {
    const jar = new Jar();
    const { email } = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: usuario }, select: { email: true } });
    const login = await llamar(jar, "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PASSWORD_INTERNO }) });
    assert.equal(login.status, 200, `login ${usuario}`);
    return jar;
  }
  const admin = await loginInterno("admin.ecommerce.seed");
  const auditor = await loginInterno("auditor.seed");

  const altaValida = (extra: Record<string, unknown> = {}) => ({
    codigo: `e4http${randomUUID().slice(0, 8)}`,
    tipo_beneficio: "PORCENTAJE",
    valor: "10",
    vigente_desde: isoEnDias(-1),
    vigente_hasta: isoEnDias(10),
    ...extra,
  });
  const crear = (body: Record<string, unknown>) =>
    llamar(admin, "/api/ecommerce/cupones", { method: "POST", body: JSON.stringify(body) });

  /** Cuenta web logueada con un carrito listo para el checkout. */
  async function cuentaConCarrito(precio = 10000) {
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 5, precio });
    const cuenta = await fixtures.crearCuenta(prisma, { passwordHash: hash });
    const jar = new Jar();
    const login = await llamar(jar, "/api/tienda/cuenta/login", {
      method: "POST",
      body: JSON.stringify({ email: cuenta.email, password: PASSWORD_WEB }),
    });
    assert.equal(login.status, 200);
    const item = await llamar(jar, "/api/tienda/carrito/items", {
      method: "POST",
      body: JSON.stringify({ variante_sku_id: articulo.varianteId, cantidad: 1 }),
    });
    assert.equal(item.status, 201);
    return { cuenta, jar };
  }
  const checkoutCon = async (codigo: string, precio = 10000) => {
    const { jar } = await cuentaConCarrito(precio);
    return llamar(jar, "/api/tienda/checkout", { method: "POST", body: JSON.stringify({ cupon_codigo: codigo }) });
  };

  // ── Permisos ───────────────────────────────────────────────────────────────
  await t.test("401 sin sesión y 403 sin el permiso en todas las rutas", async () => {
    const id = randomUUID();
    const rutas: [string, string, unknown?][] = [
      ["GET", "/api/ecommerce/cupones"],
      ["POST", "/api/ecommerce/cupones", altaValida()],
      ["GET", `/api/ecommerce/cupones/${id}`],
      ["PATCH", `/api/ecommerce/cupones/${id}`, { limite_uso_por_cliente: 2 }],
      ["PATCH", `/api/ecommerce/cupones/${id}/baja`, { motivo: "Prueba de permisos" }],
    ];
    for (const [method, path, body] of rutas) {
      const init = { method, ...(body ? { body: JSON.stringify(body) } : {}) };
      assert.equal((await llamar(new Jar(), path, init)).status, 401, `${method} ${path} sin sesión`);
      assert.equal((await llamar(auditor, path, init)).status, 403, `${method} ${path} auditor`);
    }
  });

  await t.test("pantalla /ecommerce/cupones: el admin la ve; el auditor es redirigido", async () => {
    assert.equal((await llamar(admin, "/ecommerce/cupones")).status, 200);
    const sinPermiso = await llamar(auditor, "/ecommerce/cupones");
    assert.ok([307, 308].includes(sinPermiso.status), String(sinPermiso.status));
    assert.match(sinPermiso.response.headers.get("location") ?? "", /\/no-autorizado/);
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  await t.test("POST: 201 con el DTO; 409 código existente; 400 con fieldErrors", async () => {
    const body = altaValida({ limite_uso_global: 5 });
    const creado = await crear(body);
    assert.equal(creado.status, 201);
    assert.equal(creado.body.error, null);
    assert.equal(creado.body.data.cupon.codigo, (body.codigo as string).toUpperCase());
    assert.equal(creado.body.data.cupon.valor, "10.00");
    assert.equal(creado.body.data.cupon.estado, "VIGENTE");
    assert.equal(creado.body.data.cupon.capacidad_disponible, 5);

    const repetido = await crear(body);
    assert.equal(repetido.status, 409);
    assert.equal(repetido.body.error.code, "CUPON_CODIGO_EXISTENTE");

    for (const [extra, campo] of [
      [{ valor: "100" }, "valor"],
      [{ valor: "10.555" }, "valor"],
      [{ vigente_hasta: isoEnDias(-5) }, "vigente_hasta"],
      [{ codigo: "A B" }, "codigo"],
    ] as const) {
      const invalido = await crear(altaValida(extra));
      assert.equal(invalido.status, 400, JSON.stringify(extra));
      assert.equal(invalido.body.error.code, "VALIDATION_ERROR");
      assert.ok(invalido.body.error.fieldErrors[campo], campo);
    }
    const conActor = await crear({ ...altaValida(), deleted_by: "otro" });
    assert.equal(conActor.status, 400, "body estricto: el actor sale de la sesión");
    assert.equal((await llamar(admin, "/api/ecommerce/cupones", { method: "POST", body: "no-json" })).status, 400);
  });

  // ── Listar y ver ───────────────────────────────────────────────────────────
  await t.test("GET listado: filtro y búsqueda; 400 con filtro inválido. GET por id: 200 y 404", async () => {
    const creado = (await crear(altaValida())).body.data.cupon;
    const lista = await llamar(admin, `/api/ecommerce/cupones?q=${creado.codigo.toLowerCase()}`);
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.body.data.items.map((c: { id: string }) => c.id), [creado.id]);
    assert.equal((await llamar(admin, `/api/ecommerce/cupones?estado=INACTIVOS&q=${creado.codigo}`)).body.data.items.length, 0);
    assert.equal((await llamar(admin, "/api/ecommerce/cupones?estado=BORRADOS")).status, 400);

    const ver = await llamar(admin, `/api/ecommerce/cupones/${creado.id}`);
    assert.equal(ver.status, 200);
    assert.equal(ver.body.data.cupon.id, creado.id);
    const inexistente = await llamar(admin, `/api/ecommerce/cupones/${randomUUID()}`);
    assert.equal(inexistente.status, 404);
    assert.equal(inexistente.body.error.code, "CUPON_NO_ENCONTRADO");
  });

  // ── Editar ─────────────────────────────────────────────────────────────────
  await t.test("PATCH: 200 libre; 400 inválido o con código; 404; 409 restringida; 409 inactivo", async () => {
    const creado = (await crear(altaValida({ limite_uso_global: 2 }))).body.data.cupon;
    const patch = (id: string, body: unknown) =>
      llamar(admin, `/api/ecommerce/cupones/${id}`, { method: "PATCH", body: JSON.stringify(body) });

    const libre = await patch(creado.id, { valor: "12.5", vigente_hasta: isoEnDias(15) });
    assert.equal(libre.status, 200);
    assert.equal(libre.body.data.cupon.valor, "12.50");
    assert.equal((await patch(creado.id, { codigo: "OTRO" })).status, 400);
    assert.equal((await patch(creado.id, {})).status, 400);
    const cruzado = await patch(creado.id, { vigente_hasta: isoEnDias(-3) });
    assert.equal(cruzado.status, 400);
    assert.ok(cruzado.body.error.fieldErrors.vigente_hasta);
    assert.equal((await patch(randomUUID(), { limite_uso_por_cliente: 2 })).status, 404);

    // Con una aplicación: solo se amplían límites.
    const checkout = await checkoutCon(creado.codigo);
    assert.equal(checkout.status, 201);
    const restringida = await patch(creado.id, { valor: "20" });
    assert.equal(restringida.status, 409);
    assert.equal(restringida.body.error.code, "CUPON_EDICION_RESTRINGIDA");
    assert.equal((await patch(creado.id, { limite_uso_global: 1 })).status, 409);
    assert.equal((await patch(creado.id, { limite_uso_global: 10 })).status, 200);

    // Dado de baja: no se edita.
    await llamar(admin, `/api/ecommerce/cupones/${creado.id}/baja`, { method: "PATCH", body: JSON.stringify({ motivo: "Fin de campaña" }) });
    const inactivo = await patch(creado.id, { limite_uso_global: 20 });
    assert.equal(inactivo.status, 409);
    assert.equal(inactivo.body.error.code, "CUPON_INACTIVO");
  });

  // ── Baja ───────────────────────────────────────────────────────────────────
  await t.test("PATCH baja: 200 con los campos de baja; repetida 200 sin cambios; 400 motivo; 404", async () => {
    const creado = (await crear(altaValida())).body.data.cupon;
    const baja = (id: string, body: unknown) =>
      llamar(admin, `/api/ecommerce/cupones/${id}/baja`, { method: "PATCH", body: JSON.stringify(body) });
    assert.equal((await baja(creado.id, { motivo: "x" })).status, 400);
    assert.equal((await baja(creado.id, {})).status, 400);

    const primera = await baja(creado.id, { motivo: "Fin de la campaña" });
    assert.equal(primera.status, 200);
    assert.equal(primera.body.data.cupon.is_active, false);
    assert.equal(primera.body.data.cupon.estado, "DADO_DE_BAJA");
    assert.equal(primera.body.data.cupon.deletion_reason, "Fin de la campaña");
    const fila = await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: creado.id } });
    const adminId = (await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: "admin.ecommerce.seed" } })).id;
    assert.equal(fila.deleted_by, adminId, "el actor sale de la sesión");

    const repetida = await baja(creado.id, { motivo: "Otro motivo" });
    assert.equal(repetida.status, 200);
    assert.equal(repetida.body.data.cupon.deletion_reason, "Fin de la campaña");
    assert.equal(repetida.body.data.cupon.deleted_at, primera.body.data.cupon.deleted_at);
    assert.equal((await baja(randomUUID(), { motivo: "No existe" })).status, 404);
  });

  await t.test("F02 — body no-JSON, null o array en crear, editar y baja: 400 con el envelope y el mensaje en español", async () => {
    const creado = (await crear(altaValida())).body.data.cupon;
    const rutas: [string, string][] = [
      ["POST", "/api/ecommerce/cupones"],
      ["PATCH", `/api/ecommerce/cupones/${creado.id}`],
      ["PATCH", `/api/ecommerce/cupones/${creado.id}/baja`],
    ];
    for (const [method, path] of rutas) {
      for (const body of ["no-json", "null", "[]"]) {
        const respuesta = await llamar(admin, path, { method, body });
        assert.equal(respuesta.status, 400, `${method} ${path} ${body}`);
        assert.deepEqual(respuesta.body, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Los datos enviados no son válidos",
            fieldErrors: {},
            formErrors: ["El cuerpo debe ser un objeto JSON"],
          },
        });
      }
    }
    assert.equal((await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: creado.id } })).is_active, true, "sin cambios");
  });

  // ── Checkout con cupón (E2) ────────────────────────────────────────────────
  await t.test("checkout: cupón válido 201 con total neto; cada error de cupón 422 con su código", async () => {
    const valido = (await crear(altaValida({ valor: "10" }))).body.data.cupon;
    const ok = await checkoutCon(valido.codigo.toLowerCase());
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.total, 9000);

    const noVigente = (await crear(altaValida({ vigente_desde: isoEnDias(2), vigente_hasta: isoEnDias(5) }))).body.data.cupon;
    const agotado = (await crear(altaValida({ limite_uso_global: 1 }))).body.data.cupon;
    assert.equal((await checkoutCon(agotado.codigo)).status, 201, "ocupa el único lugar");
    const noAplicable = (await crear(altaValida({ tipo_beneficio: "MONTO_FIJO", valor: "10000" }))).body.data.cupon;
    const inactivo = (await crear(altaValida())).body.data.cupon;
    await llamar(admin, `/api/ecommerce/cupones/${inactivo.id}/baja`, { method: "PATCH", body: JSON.stringify({ motivo: "Baja de prueba" }) });
    const vencido = await prisma.cuponDescuento.create({
      data: {
        codigo: `E4HTTPVENC${randomUUID().slice(0, 6).toUpperCase()}`,
        tipo_beneficio: "PORCENTAJE",
        valor: 10,
        vigente_desde: new Date(Date.now() - 3 * DIA_MS),
        vigente_hasta: new Date(Date.now() - DIA_MS),
      },
    });

    for (const [codigo, esperado] of [
      ["NOEXISTE-E4", "CUPON_NO_ENCONTRADO"],
      [inactivo.codigo, "CUPON_INACTIVO"],
      [noVigente.codigo, "CUPON_NO_VIGENTE"],
      [vencido.codigo, "CUPON_VENCIDO"],
      [agotado.codigo, "CUPON_LIMITE_ALCANZADO"],
      [noAplicable.codigo, "CUPON_NO_APLICABLE"],
    ] as const) {
      const r = await checkoutCon(codigo);
      assert.equal(r.status, 422, `${esperado}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error.code, esperado);
      assert.ok(r.body.error.message.length > 0);
    }
  });
  // ── Desglose en la página de pago pendiente (Obs 8) ────────────────────────
  /** Texto visible de una página de la tienda: sin comentarios de React ni etiquetas, espacios normalizados. */
  const textoDe = (html: string) =>
    html
      .replace(/<!--.*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|\u00a0/g, " ")
      .replace(/\s+/g, " ");

  await t.test("pendiente: con cupón muestra subtotal, código, descuento y total; sin cupón no hay desglose", async () => {
    const cupon = (await crear(altaValida({ valor: "10" }))).body.data.cupon;
    const con = await cuentaConCarrito(10000);
    const conCupon = await llamar(con.jar, "/api/tienda/checkout", { method: "POST", body: JSON.stringify({ cupon_codigo: cupon.codigo }) });
    assert.equal(conCupon.status, 201);
    const paginaCon = await llamar(con.jar, `/tienda/checkout/pendiente?pedido=${conCupon.body.data.pedido_venta_id}`);
    assert.equal(paginaCon.status, 200);
    const textoCon = textoDe(await paginaCon.response.text());
    assert.match(textoCon, /Subtotal \$ 10\.000,00/);
    assert.ok(textoCon.includes(`Cupón ${cupon.codigo}`), textoCon);
    assert.match(textoCon, /−\$ 1\.000,00/);
    assert.match(textoCon, /Total \$ 9\.000,00/);

    const sin = await cuentaConCarrito(10000);
    const sinCupon = await llamar(sin.jar, "/api/tienda/checkout", { method: "POST", body: JSON.stringify({}) });
    assert.equal(sinCupon.status, 201);
    const paginaSin = await llamar(sin.jar, `/tienda/checkout/pendiente?pedido=${sinCupon.body.data.pedido_venta_id}`);
    assert.equal(paginaSin.status, 200);
    const textoSin = textoDe(await paginaSin.response.text());
    assert.match(textoSin, /Total \$ 10\.000,00/);
    assert.doesNotMatch(textoSin, /Subtotal|Cupón/);
  });
});
