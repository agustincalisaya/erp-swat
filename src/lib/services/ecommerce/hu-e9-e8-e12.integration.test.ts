import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/**
 * HU-E9 T07 — Integración real Cliente Web (E8) → preparación (E12) → historial
 * y detalle (E9). Requiere una base PostgreSQL dedicada con migraciones y seed,
 * más un servidor Next.js local apuntando a esa misma base.
 */
const BASE_URL = process.env.HU_E8_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E8_INTEGRATION_DATABASE_URL ?? process.env.HU_E9_E8_E12_INTEGRATION_DATABASE_URL;
const PASSWORD_CLIENTE = "password-segura";
const PASSWORD_INTERNO = "abc123456789";
const OPERADOR_EMAIL = "operador.pickpack.seed@erp-swat.local";

class Jar {
  private readonly cookies = new Map<string, string>();

  absorber(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (value) this.cookies.set(name.trim(), value);
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function llamar(jar: Jar, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie: jar.header(), ...(init.headers ?? {}) },
  });
  jar.absorber(response);
  const text = await response.text();
  const body = response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null;
  return { status: response.status, body, text, response };
}

async function loginClienteWeb(email: string) {
  const jar = new Jar();
  const result = await llamar(jar, "/api/tienda/cuenta/login", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD_CLIENTE }),
  });
  assert.equal(result.status, 200);
  return jar;
}

async function loginOperador() {
  const jar = new Jar();
  const result = await llamar(jar, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: OPERADOR_EMAIL, password: PASSWORD_INTERNO }),
  });
  assert.equal(result.status, 200);
  return jar;
}

function assertCachePrivada(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

function assertSinToken(texto: string, headers: Headers, token: string) {
  assert.ok(!texto.includes(token), "El token interno de retiro no debe aparecer en el body");
  assert.ok(!JSON.stringify([...headers.entries()]).includes(token), "El token interno de retiro no debe aparecer en headers");
}

const error404 = {
  data: null,
  error: { code: "PEDIDO_NO_ENCONTRADO", message: "El pedido solicitado no existe" },
};

const sensibles = [
  "codigo_qr_retiro", "qr_inconsistente", "mercadopago_payment_id", "access_token", "operador_asignado_id",
  "prioridad_manual", "escaneos", "cae_simulado", "es_simulado", "qr_data_url_fiscal", "deleted_at",
  "deleted_by", "deletion_reason",
];

test("HU-E9 T07 — E8 real, E12 real y acceso E9 solo del propietario", {
  skip: !BASE_URL || !DATABASE_URL ? "Faltan HU_E8_INTEGRATION_BASE_URL y HU_E8_INTEGRATION_DATABASE_URL/HU_E9_E8_E12_INTEGRATION_DATABASE_URL" : false,
  timeout: 240_000,
}, async (t) => {
  if (!BASE_URL || !DATABASE_URL) throw new Error("Faltan HU_E8_INTEGRATION_BASE_URL y una URL de base de integración");
  const url = new URL(DATABASE_URL);
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:")) throw new Error("HU-E9 T07 requiere PostgreSQL de integración");

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.APP_PUBLIC_URL = BASE_URL;
  process.env.MP_MODO = "simulado";

  const [{ prisma }, fixtures, carrito, checkout, pagoWeb, { hashPassword }] = await Promise.all([
    import("../../db/prisma.ts"),
    import("./hu-e1.test-fixtures.ts"),
    import("./carrito.service.ts"),
    import("./checkout.service.ts"),
    import("./pago-web.service.ts"),
    import("../../auth/password-hash-core.ts"),
  ]);
  t.after(() => prisma.$disconnect());

  const { hash } = await hashPassword(PASSWORD_CLIENTE);
  const cuentaA = await fixtures.crearCuenta(prisma, { passwordHash: hash });
  const cuentaB = await fixtures.crearCuenta(prisma, { passwordHash: hash });
  const jarA = await loginClienteWeb(cuentaA.email);
  const jarB = await loginClienteWeb(cuentaB.email);

  const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 1, precio: 10000 });
  await carrito.agregarAlCarrito(
    { cuentaId: cuentaA.cuentaId },
    { variante_sku_id: articulo.varianteId, cantidad: 1 },
  );
  const checkoutIniciado = await checkout.iniciarCheckout(cuentaA.sesion);

  const paymentId = `t7-${randomUUID()}`;
  const pagoAprobado: PagoConsultado = {
    payment_id: paymentId,
    estado: "APROBADO",
    status_mp: "approved",
    status_detail: "accredited",
    monto: checkoutIniciado.total,
    moneda: "ARS",
    external_reference: checkoutIniciado.pedido_venta_ecommerce_id,
    fecha_aprobacion: new Date().toISOString(),
  };
  const pasarela = {
    consultarPago: async (id: string) => {
      assert.equal(id, paymentId);
      return pagoAprobado;
    },
    cerrarCobro: async () => undefined,
  };

  const pago = await pagoWeb.procesarNotificacionPago(paymentId, pasarela);
  assert.equal(pago.resultado, "CONFIRMADO");

  const admitido = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
    where: { pedido_venta_id: checkoutIniciado.pedido_venta_id },
    select: {
      estado_ecommerce: true,
      codigo_qr_retiro: true,
      plazo_retiro_vencimiento: true,
      pedido_venta: { select: { cliente_id: true } },
    },
  });
  assert.equal(admitido.pedido_venta.cliente_id, cuentaA.clienteId);
  assert.equal(admitido.estado_ecommerce, "EN_PREPARACION");
  assert.equal(admitido.codigo_qr_retiro, null);
  assert.equal(admitido.plazo_retiro_vencimiento, null);

  await t.test("antes de completar E12, E9 muestra el pedido sin QR", async () => {
    const detalle = await llamar(jarA, `/api/tienda/mis-pedidos/${checkoutIniciado.pedido_venta_id}`);
    assert.equal(detalle.status, 200);
    assertCachePrivada(detalle.response);
    assert.equal(detalle.body.data.estado, "EN_PREPARACION");
    assert.equal(detalle.body.data.qr_data_url, null);
    assert.equal(detalle.body.data.plazo_retiro_vencimiento, null);
  });

  const operador = await loginOperador();

  await t.test("E12 real toma, escanea y completa la preparación", async () => {
    const tomar = await llamar(operador, `/api/ecommerce/preparacion/${checkoutIniciado.pedido_venta_id}/tomar`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(tomar.status, 200);
    assert.equal(tomar.body.data.cambio_realizado, true);

    const scan = await llamar(operador, `/api/ecommerce/preparacion/${checkoutIniciado.pedido_venta_id}/scan`, {
      method: "POST",
      body: JSON.stringify({ scan_id: randomUUID(), codigo: articulo.sku }),
    });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.data.progreso.completo, true);

    const completar = await llamar(operador, `/api/ecommerce/preparacion/${checkoutIniciado.pedido_venta_id}/completar`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(completar.status, 200);
    assert.equal(completar.body.data.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.equal(completar.body.data.transicion_realizada, true);
    assert.doesNotMatch(completar.text, /codigo_qr_retiro/);
  });

  const persistido = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
    where: { pedido_venta_id: checkoutIniciado.pedido_venta_id },
    select: { estado_ecommerce: true, codigo_qr_retiro: true, plazo_retiro_vencimiento: true },
  });
  assert.equal(persistido.estado_ecommerce, "LISTO_PARA_RETIRO");
  const tokenInterno = persistido.codigo_qr_retiro;
  const plazoPersistido = persistido.plazo_retiro_vencimiento;
  assert.ok(tokenInterno);
  assert.ok(plazoPersistido);
  const plazoIso = plazoPersistido.toISOString();

  await t.test("Cliente A ve el detalle listo con QR y DTO mínimo", async () => {
    const detalle = await llamar(jarA, `/api/tienda/mis-pedidos/${checkoutIniciado.pedido_venta_id}`);
    assert.equal(detalle.status, 200);
    assertCachePrivada(detalle.response);
    assert.equal(detalle.body.data.estado, "LISTO_PARA_RETIRO");
    assert.equal(typeof detalle.body.data.qr_data_url, "string");
    assert.ok(detalle.body.data.qr_data_url.startsWith("data:image/"));
    assert.equal(detalle.body.data.plazo_retiro_vencimiento, plazoIso);
    assert.equal(detalle.body.data.id, checkoutIniciado.pedido_venta_id);
    assert.deepEqual(Object.keys(detalle.body.data.items[0]).sort(), ["cantidad", "color", "precio_unitario", "producto", "sku", "talle"]);
    assert.deepEqual(Object.keys(detalle.body.data.comprobante).sort(), ["fecha_emision", "monto", "tipo"]);
    for (const sensible of sensibles) assert.ok(!detalle.text.toLowerCase().includes(sensible.toLowerCase()), sensible);
    assertSinToken(detalle.text, detalle.response.headers, tokenInterno);
  });

  await t.test("Cliente B recibe el 404 contractual sin QR ni datos del pedido A", async () => {
    const detalle = await llamar(jarB, `/api/tienda/mis-pedidos/${checkoutIniciado.pedido_venta_id}`);
    assert.equal(detalle.status, 404);
    assert.deepEqual(detalle.body, error404);
    assert.equal(detalle.text, JSON.stringify(error404));
    assertCachePrivada(detalle.response);
    assertSinToken(detalle.text, detalle.response.headers, tokenInterno);
  });

  await t.test("historiales A/B por HTTP respetan propiedad y nunca exponen QR", async () => {
    const historialA = await llamar(jarA, "/api/tienda/mis-pedidos?page=1&page_size=20");
    assert.equal(historialA.status, 200);
    assertCachePrivada(historialA.response);
    assert.ok(historialA.body.data.pedidos.some((pedido: { id: string }) => pedido.id === checkoutIniciado.pedido_venta_id));

    const historialB = await llamar(jarB, "/api/tienda/mis-pedidos?page=1&page_size=20");
    assert.equal(historialB.status, 200);
    assertCachePrivada(historialB.response);
    assert.ok(!historialB.body.data.pedidos.some((pedido: { id: string }) => pedido.id === checkoutIniciado.pedido_venta_id));

    for (const historial of [historialA, historialB]) {
      assert.doesNotMatch(historial.text, /qr_data_url|codigo_qr_retiro|plazo_retiro_vencimiento/);
      assertSinToken(historial.text, historial.response.headers, tokenInterno);
    }
  });
});
