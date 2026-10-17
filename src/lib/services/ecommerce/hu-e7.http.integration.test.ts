import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * HU-E7 — Nivel 2 HTTP: `PATCH /api/ecommerce/pedidos/[id]/anular` y la
 * pantalla `/ecommerce/pedidos`, contra un servidor APARTE apuntando a la base
 * de test (mismo procedimiento que `hu-e5.http.integration.test.ts`). Las dos
 * variables deben apuntar a la MISMA base.
 *
 *   DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3107 npx next dev -p 3107
 *   HU_E7_INTEGRATION_BASE_URL=http://localhost:3107 HU_E7_INTEGRATION_DATABASE_URL=$TEST_DB \
 *     npm run test:integration:e7-http
 *
 * Las órdenes se crean con el carrito y el checkout reales (E1/E2) en el
 * proceso del test. Nunca se borra nada (Regla N.° 1).
 */

const BASE_URL = process.env.HU_E7_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E7_INTEGRATION_DATABASE_URL;
const PASSWORD_INTERNO = "abc123456789";
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";
const PEDIDO_WEB_EN_PREPARACION_SEED_ID = "91a9f1cf-e278-4f9c-8584-4ee166c6c01d";
const PEDIDO_MOSTRADOR_RESERVADO_SEED_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000002";
const MENSAJE_409 = "Solo una orden no abonada (Pago Pendiente o Pago Rechazado) puede anularse por esta vía";

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
  const esJson = response.headers.get("content-type")?.includes("json");
  const body = esJson ? await response.json() : null;
  const texto = esJson ? "" : await response.text();
  return { status: response.status, body, texto, response };
}

const patch = (jar: Jar, path: string, body: unknown) =>
  llamar(jar, path, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) });
const ruta = (id: string) => `/api/ecommerce/pedidos/${id}/anular`;

test(
  "HU-E7 HTTP — anulación manual de orden web no abonada y pantalla /ecommerce/pedidos",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 300_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MP_MODO = "simulado";
    process.env.APP_PUBLIC_URL ??= BASE_URL;
    const [{ prisma }, fixtures, carrito, checkout] = await Promise.all([
      import("@/lib/db/prisma"),
      import("./hu-e1.test-fixtures"),
      import("./carrito.service"),
      import("./checkout.service"),
    ]);
    t.after(async () => prisma.$disconnect());

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e7-http] current_database() = ${db}`);

    async function loginInterno(usuario: string) {
      const jar = new Jar();
      const { email } = await prisma.usuario.findUniqueOrThrow({ where: { nombre_usuario: usuario }, select: { email: true } });
      const login = await llamar(jar, "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PASSWORD_INTERNO }) });
      assert.equal(login.status, 200, `login ${usuario}`);
      return jar;
    }
    const admin = await loginInterno("admin.ecommerce.seed");
    const operador = await loginInterno("operador.pickpack.seed");

    async function ordenPendiente() {
      const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 5 });
      const cuenta = await fixtures.crearCuenta(prisma);
      await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 2 });
      const iniciado = await checkout.iniciarCheckout(cuenta.sesion);
      return { articulo, pv: iniciado.pedido_venta_id, numero: iniciado.numero_venta };
    }
    const estadoOrden = (id: string) =>
      prisma.pedidoVenta.findUniqueOrThrow({ where: { id }, select: { estado: true, is_active: true, ecommerce: true } });

    await t.test("401 sin sesión y 403 sin ecommerce:anular_orden_no_abonada (Operador de Pick & Pack)", async () => {
      const { pv } = await ordenPendiente();
      const sinSesion = await patch(new Jar(), ruta(pv), { deletion_reason: "Prueba" });
      assert.equal(sinSesion.status, 401);
      assert.equal(sinSesion.body.error.code, "UNAUTHORIZED");
      const sinPermiso = await patch(operador, ruta(pv), { deletion_reason: "Prueba" });
      assert.equal(sinPermiso.status, 403);
      assert.equal(sinPermiso.body.error.code, "FORBIDDEN");
      const intacta = await estadoOrden(pv);
      assert.equal(intacta.ecommerce?.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(intacta.is_active, true);
    });

    await t.test("400 VALIDATION_ERROR: id, raíz del cuerpo, motivo vacío/espacios/ausente/no texto y campos extra", async () => {
      const { pv } = await ordenPendiente();
      const casos: [string, unknown, string][] = [
        [ruta("no-es-uuid"), { deletion_reason: "Motivo" }, "El identificador del pedido es inválido"],
        [ruta(pv), "null", "El cuerpo debe ser un objeto JSON"],
        [ruta(pv), "[]", "El cuerpo debe ser un objeto JSON"],
        [ruta(pv), "esto no es json", "El cuerpo debe ser un objeto JSON"],
        [ruta(pv), { deletion_reason: "" }, "El motivo de anulación es obligatorio"],
        [ruta(pv), { deletion_reason: "   " }, "El motivo de anulación es obligatorio"],
        [ruta(pv), {}, "El motivo de anulación es obligatorio"],
        [ruta(pv), { deletion_reason: 42 }, "El motivo de anulación debe ser texto"],
        [ruta(pv), { deletion_reason: "Motivo", actor_id: USUARIO_ADMIN_ECOMMERCE_SEED_ID }, "El cuerpo contiene campos no permitidos"],
        [ruta(pv), { deletion_reason: "Motivo", deleted_by: USUARIO_ADMIN_ECOMMERCE_SEED_ID }, "El cuerpo contiene campos no permitidos"],
        [ruta(pv), { deletion_reason: "Motivo", estado: "ANULADO" }, "El cuerpo contiene campos no permitidos"],
      ];
      for (const [path, body, mensaje] of casos) {
        const r = await patch(admin, path, body);
        assert.equal(r.status, 400, `${path} ${JSON.stringify(body)}`);
        assert.equal(r.body.data, null);
        assert.equal(r.body.error.code, "VALIDATION_ERROR");
        assert.equal(r.body.error.message, mensaje, JSON.stringify(body));
      }
      assert.equal((await estadoOrden(pv)).ecommerce?.estado_ecommerce, "PAGO_PENDIENTE", "ningún 400 tocó la orden");
    });

    await t.test("404 PEDIDO_WEB_NO_ENCONTRADO: id inexistente y pedido de mostrador", async () => {
      for (const id of [randomUUID(), PEDIDO_MOSTRADOR_RESERVADO_SEED_ID]) {
        const r = await patch(admin, ruta(id), { deletion_reason: "Motivo" });
        assert.equal(r.status, 404, id);
        assert.deepEqual(r.body, { data: null, error: { code: "PEDIDO_WEB_NO_ENCONTRADO", message: "El pedido no existe o no es un pedido web" } });
      }
    });

    await t.test("200 manual (actor de la sesión) y 409 en la segunda anulación y en un pedido EN_PREPARACION", async () => {
      const { articulo, pv } = await ordenPendiente();
      const ok = await patch(admin, ruta(pv), { deletion_reason: "  El cliente desistió  " });
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body, { data: { pedido_venta_id: pv, estado_ecommerce: "ANULADO", stock_liberado: true }, error: null });
      const anulada = await estadoOrden(pv);
      assert.equal(anulada.estado, "ANULADO");
      assert.equal(anulada.ecommerce?.deleted_by, USUARIO_ADMIN_ECOMMERCE_SEED_ID, "el actor sale de la sesión");
      assert.equal(anulada.ecommerce?.deletion_reason, "El cliente desistió");
      const stock = await prisma.stockDeposito.findFirstOrThrow({ where: { variante_sku_id: articulo.varianteId } });
      assert.equal(stock.cantidad, 5);

      for (const id of [pv, PEDIDO_WEB_EN_PREPARACION_SEED_ID]) {
        const r = await patch(admin, ruta(id), { deletion_reason: "Otra vez" });
        assert.equal(r.status, 409, id);
        assert.deepEqual(r.body, { data: null, error: { code: "TRANSICION_INVALIDA", message: MENSAJE_409 } });
      }
      assert.equal((await estadoOrden(pv)).ecommerce?.deletion_reason, "El cliente desistió", "el 409 no pisa la baja");
    });

    await t.test("pantalla /ecommerce/pedidos: admin la ve (con la orden y la entrada del Sidebar); operador → /no-autorizado; sin sesión → /login", async () => {
      const { numero } = await ordenPendiente();
      const pagina = await llamar(admin, "/ecommerce/pedidos");
      assert.equal(pagina.status, 200);
      assert.match(pagina.texto, new RegExp(numero));
      assert.match(pagina.texto, /href="\/ecommerce\/pedidos"/, "entrada 'Pedidos web' en el Sidebar del admin");
      const sinPermiso = await llamar(operador, "/ecommerce/pedidos");
      assert.ok([307, 308].includes(sinPermiso.status), String(sinPermiso.status));
      assert.match(sinPermiso.response.headers.get("location") ?? "", /\/no-autorizado/);
      const sinSesion = await llamar(new Jar(), "/ecommerce/pedidos");
      assert.ok([307, 308].includes(sinSesion.status), String(sinSesion.status));
      assert.match(sinSesion.response.headers.get("location") ?? "", /\/login/);
      const colaOperador = await llamar(operador, "/ecommerce/preparacion");
      assert.equal(colaOperador.status, 200);
      assert.doesNotMatch(colaOperador.texto, /href="\/ecommerce\/pedidos"/, "sin entrada 'Pedidos web' para el operador");
    });
  },
);
