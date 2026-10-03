import assert from "node:assert/strict";
import test from "node:test";

/**
 * HU-E1 — Nivel 2 HTTP: lo que solo existe en la capa de Next (guard de sesión,
 * cookies firmadas, login + fusión, mapeo de errores a status).
 *
 * ⚠️ MODIFICA LA BASE A LA QUE APUNTA EL SERVIDOR: crea clientes, cuentas web,
 * artículos, carritos, reservas y pedidos propios. Correrlo contra una base de
 * TEST, nunca contra la de desarrollo de alguien (ver
 * docs/modulos/modulo E/HU1_MODULO_E.md §9.1). Exige las DOS variables, y
 * ambas deben apuntar a la MISMA base (el test prepara su estado por Prisma y
 * lo verifica por HTTP):
 *
 *   HU_E1_INTEGRATION_BASE_URL=http://localhost:3101 \
 *   HU_E1_INTEGRATION_DATABASE_URL=postgresql://…/swat_erp_test_e1?schema=public \
 *     npm run test:integration:e1-http
 *
 * Cada caso crea su propia cuenta y sus propios artículos: no depende del
 * seed (salvo usuarios/fixtures de solo lectura) ni de pedidos previos, y
 * espera un único resultado.
 */

const BASE_URL = process.env.HU_E1_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E1_INTEGRATION_DATABASE_URL;

const PASSWORD_TEST = "clave-test-hu-e1";
const VARIANTE_CAMISA_POLICIA_ID = "fadabd3f-991e-4e26-90f2-ad8cc97856c7"; // seed: sin precio vigente

/** Jar mínimo: guarda `name=value` de cada `Set-Cookie` (borra si viene vencida/vacía). */
class Jar {
  private readonly cookies = new Map<string, string>();
  absorber(res: Response) {
    for (const linea of res.headers.getSetCookie()) {
      const [par] = linea.split(";");
      const [nombre, ...valor] = par.split("=");
      const v = valor.join("=");
      if (v === "" || /expires=Thu, 01 Jan 1970/i.test(linea)) this.cookies.delete(nombre.trim());
      else this.cookies.set(nombre.trim(), v);
    }
  }
  get(nombre: string) {
    return this.cookies.get(nombre);
  }
  set(nombre: string, valor: string) {
    this.cookies.set(nombre, valor);
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function llamar(jar: Jar, ruta: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    ...init,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie: jar.header(), ...(init.headers ?? {}) },
  });
  jar.absorber(res);
  const cuerpo = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  return { status: res.status, cuerpo, res };
}

test(
  "HU-E1 HTTP — guard de sesión, cookies del carrito, fusión y checkout",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 180_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    const [{ prisma }, fixtures, { hashPassword }] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./hu-e1.test-fixtures.ts"),
      import("../../auth/password-hash-core.ts"),
    ]);
    t.after(async () => prisma.$disconnect());

    const { hash } = await hashPassword(PASSWORD_TEST);

    /** Cuenta propia + jar ya logueado (sin carrito de visitante previo). */
    async function cuentaLogueada() {
      const cuenta = await fixtures.crearCuenta(prisma, { passwordHash: hash });
      const jar = new Jar();
      const login = await llamar(jar, "/api/tienda/cuenta/login", {
        method: "POST",
        body: JSON.stringify({ email: cuenta.email, password: PASSWORD_TEST }),
      });
      assert.equal(login.status, 200);
      return { cuenta, jar };
    }

    async function agregar(jar: Jar, varianteId: string, cantidad = 1) {
      const r = await llamar(jar, "/api/tienda/carrito/items", {
        method: "POST",
        body: JSON.stringify({ variante_sku_id: varianteId, cantidad }),
      });
      assert.equal(r.status, 201);
      return r;
    }

    await t.test("CA1/CA3 — el catálogo es público; un artículo propio se lista con su disponible y precio", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 6, precio: 17500 });
      const r = await llamar(new Jar(), `/api/tienda/catalogo/${a.productoWebId}`);
      assert.equal(r.status, 200);
      assert.equal(r.cuerpo.data.variantes[0].disponible, 6);
      assert.equal(r.cuerpo.data.variantes[0].precio_venta, 17500);
    });

    await t.test("un producto con la visibilidad web apagada no se publica: 404", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 6, visible: false });
      const r = await llamar(new Jar(), `/api/tienda/catalogo/${a.productoWebId}`);
      assert.equal(r.status, 404);
      assert.equal(r.cuerpo.error.code, "PRODUCTO_WEB_NO_ENCONTRADO");
    });

    await t.test("CA3 — agregar un SKU sin precio vigente responde 422 ARTICULO_NO_DISPONIBLE identificándolo", async () => {
      const r = await llamar(new Jar(), "/api/tienda/carrito/items", {
        method: "POST",
        body: JSON.stringify({ variante_sku_id: VARIANTE_CAMISA_POLICIA_ID, cantidad: 1 }),
      });
      assert.equal(r.status, 422);
      assert.equal(r.cuerpo.error.details.items[0].motivo, "SIN_PRECIO_VIGENTE");
    });

    await t.test("CA6 — iniciar el checkout sin sesión responde 401 SESION_CLIENTE_WEB_REQUERIDA", async () => {
      const r = await llamar(new Jar(), "/api/tienda/checkout", { method: "POST" });
      assert.equal(r.status, 401);
      assert.equal(r.cuerpo.error.code, "SESION_CLIENTE_WEB_REQUERIDA");
    });

    await t.test("el personal interno no puede ingresar a la tienda (sesiones separadas): 401", async () => {
      const r = await llamar(new Jar(), "/api/tienda/cuenta/login", {
        method: "POST",
        body: JSON.stringify({ email: "admin.seed@erp-swat.local", password: "abc123456789" }),
      });
      assert.equal(r.status, 401);
    });

    await t.test("CA6 — el visitante recibe una cookie de carrito firmada y httpOnly; una cookie alterada se ignora", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 5 });
      const jar = new Jar();
      const agregado = await agregar(jar, a.varianteId);
      const setCookie = agregado.res.headers.getSetCookie().find((c) => c.startsWith("swat_carrito="));
      assert.ok(setCookie);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(jar.get("swat_carrito") ?? "", /^[0-9a-f]{48}\./);
      assert.equal((await llamar(jar, "/api/tienda/carrito")).cuerpo.data.items.length, 1);

      const falso = new Jar();
      falso.set("swat_carrito", `${(jar.get("swat_carrito") ?? "").split(".")[0]}.firma-falsa`);
      assert.equal((await llamar(falso, "/api/tienda/carrito")).cuerpo.data.items.length, 0);
    });

    await t.test("CA7 — al ingresar, el carrito del visitante se fusiona con el de la cuenta (suma de repetidos)", async () => {
      const repetido = await fixtures.crearArticulo(prisma, { stockShowroom: 10 });
      const nuevo = await fixtures.crearArticulo(prisma, { stockShowroom: 10 });
      const cuenta = await fixtures.crearCuenta(prisma, { passwordHash: hash });
      await prisma.carritoWeb.create({
        data: {
          cuenta_cliente_web_id: cuenta.cuentaId,
          items: { create: { variante_sku_id: repetido.varianteId, cantidad: 1 } },
        },
      });

      const jar = new Jar();
      await agregar(jar, repetido.varianteId, 2);
      await agregar(jar, nuevo.varianteId, 1);

      const login = await llamar(jar, "/api/tienda/cuenta/login", {
        method: "POST",
        body: JSON.stringify({ email: cuenta.email, password: PASSWORD_TEST }),
      });
      assert.equal(login.status, 200);
      assert.equal(login.cuerpo.data.carrito_fusionado, true);
      assert.ok(jar.get("swat_tienda_session"));
      assert.equal(jar.get("swat_carrito"), undefined, "la cookie del visitante se borra tras fusionar");

      const carrito = await llamar(jar, "/api/tienda/carrito");
      const cantidades = Object.fromEntries(
        carrito.cuerpo.data.items.map((i: { variante_sku_id: string; cantidad: number }) => [i.variante_sku_id, i.cantidad]),
      );
      assert.deepEqual(cantidades, { [repetido.varianteId]: 3, [nuevo.varianteId]: 1 });

      // "Otro dispositivo": un login nuevo, sin cookies previas, ve el mismo carrito.
      const otroDispositivo = new Jar();
      await llamar(otroDispositivo, "/api/tienda/cuenta/login", {
        method: "POST",
        body: JSON.stringify({ email: cuenta.email, password: PASSWORD_TEST }),
      });
      const mismo = await llamar(otroDispositivo, "/api/tienda/carrito");
      assert.equal(mismo.cuerpo.data.carrito_id, carrito.cuerpo.data.carrito_id);
    });

    await t.test("CA4 — con sesión, un artículo desactivado bloquea el checkout: 422 identificando el SKU", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 5 });
      const { cuenta, jar } = await cuentaLogueada();
      await agregar(jar, a.varianteId);
      await prisma.varianteSKU.update({
        where: { id: a.varianteId },
        data: { is_active: false, deleted_at: new Date(), deletion_reason: "test HTTP HU-E1 CA4" },
      });

      const r = await llamar(jar, "/api/tienda/checkout", { method: "POST" });
      assert.equal(r.status, 422);
      assert.equal(r.cuerpo.error.code, "ARTICULO_NO_DISPONIBLE");
      assert.deepEqual(
        r.cuerpo.error.details.items.map((i: { sku: string; motivo: string }) => [i.sku, i.motivo]),
        [[a.sku, "SKU_INACTIVO"]],
      );
      assert.equal(await prisma.pedidoVenta.count({ where: { cliente_id: cuenta.clienteId } }), 0);
    });

    await t.test("CA6/CA5 — con sesión y carrito válido, el checkout crea el pedido: 201 PAGO_PENDIENTE", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 5, precio: 20000 });
      const { jar } = await cuentaLogueada();
      await agregar(jar, a.varianteId, 2);

      const r = await llamar(jar, "/api/tienda/checkout", { method: "POST" });
      assert.equal(r.status, 201);
      assert.equal(r.cuerpo.data.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(r.cuerpo.data.reutilizado, false);
      assert.equal(r.cuerpo.data.total, 40000);
      assert.equal((await llamar(jar, "/api/tienda/carrito")).cuerpo.data.items.length, 0, "el carrito se convirtió en pedido");
    });

    await t.test("D10 — repetir el checkout con un pedido vigente devuelve el mismo pedido: 200 reutilizado", async () => {
      const a = await fixtures.crearArticulo(prisma, { stockShowroom: 5 });
      const { jar } = await cuentaLogueada();
      await agregar(jar, a.varianteId);
      const primero = await llamar(jar, "/api/tienda/checkout", { method: "POST" });
      assert.equal(primero.status, 201);

      const segundo = await llamar(jar, "/api/tienda/checkout", { method: "POST" });
      assert.equal(segundo.status, 200);
      assert.equal(segundo.cuerpo.data.reutilizado, true);
      assert.equal(segundo.cuerpo.data.pedido_venta_id, primero.cuerpo.data.pedido_venta_id);
    });

    await t.test(
      "D10 caso 1 (ex BUG CA5/D10) — con un pedido Pago Pendiente vigente, un carrito nuevo genera OTRO pedido (201) y el carrito queda vacío",
      async () => {
        const viejo = await fixtures.crearArticulo(prisma, { stockShowroom: 5 });
        const nuevo = await fixtures.crearArticulo(prisma, { stockShowroom: 5 });
        const { jar } = await cuentaLogueada();
        await agregar(jar, viejo.varianteId);
        const primero = await llamar(jar, "/api/tienda/checkout", { method: "POST" });
        assert.equal(primero.status, 201);
        assert.equal((await llamar(jar, "/api/tienda/carrito")).cuerpo.data.items.length, 0, "tras el checkout el carrito está vacío");

        await agregar(jar, nuevo.varianteId);
        const segundo = await llamar(jar, "/api/tienda/checkout", { method: "POST" });
        assert.equal(segundo.status, 201);
        assert.equal(segundo.cuerpo.data.reutilizado, false);
        assert.notEqual(segundo.cuerpo.data.pedido_venta_id, primero.cuerpo.data.pedido_venta_id);
        assert.equal((await llamar(jar, "/api/tienda/carrito")).cuerpo.data.items.length, 0, "GET del carrito: vacío");

        // La página de pendiente muestra el pedido pedido por id.
        const pagina = await fetch(
          `${BASE_URL}/tienda/checkout/pendiente?pedido=${segundo.cuerpo.data.pedido_venta_id}`,
          { headers: { cookie: jar.header() } },
        );
        const html = await pagina.text();
        assert.match(html, new RegExp(segundo.cuerpo.data.numero_venta));
        assert.doesNotMatch(html, new RegExp(primero.cuerpo.data.numero_venta));
      },
    );

    await t.test("D10 caso 3 — sin carrito con ítems ni pedido vigente: 422 CARRITO_VACIO", async () => {
      const { jar } = await cuentaLogueada();
      const r = await llamar(jar, "/api/tienda/checkout", { method: "POST" });
      assert.equal(r.status, 422);
      assert.equal(r.cuerpo.error.code, "CARRITO_VACIO");
    });

    await t.test("logout: después de salir, el checkout vuelve a pedir sesión (401)", async () => {
      const { jar } = await cuentaLogueada();
      assert.equal((await llamar(jar, "/api/tienda/cuenta/logout", { method: "POST" })).status, 200);
      assert.equal((await llamar(jar, "/api/tienda/checkout", { method: "POST" })).status, 401);
    });

    await t.test("las páginas de la tienda responden y /tienda redirige al catálogo", async () => {
      const jar = new Jar();
      for (const ruta of ["/tienda/catalogo", "/tienda/carrito", "/tienda/ingresar"]) {
        assert.equal((await llamar(jar, ruta)).status, 200, ruta);
      }
      const raiz = await llamar(jar, "/tienda");
      assert.equal(raiz.status, 307);
      assert.match(raiz.res.headers.get("location") ?? "", /\/tienda\/catalogo$/);
    });
  },
);
