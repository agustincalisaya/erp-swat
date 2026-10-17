import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const BASE_URL = process.env.HU_E13_T11_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E13_T11_INTEGRATION_DATABASE_URL;
const PASSWORD_WEB = "hu-e13-http-password";
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
  header() { return [...this.cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join("; "); }
}

async function llamar(jar: Jar, path: string, method: "PATCH" | "POST", body: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: jar.header() },
    body: JSON.stringify(body),
  });
  jar.absorber(response);
  return { status: response.status, body: await response.json() };
}

test("HU-E13 T11 HTTP — cancelaciones y reintento manual seguros", {
  skip: !BASE_URL || !DATABASE_URL,
  timeout: 300_000,
}, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MP_MODO = "simulado";
  process.env.APP_PUBLIC_URL = BASE_URL;
  const [{ prisma }, { hashPassword }, fixtures, carrito, checkout, pagoWeb, pickPack] = await Promise.all([
    import("../../db/prisma.ts"),
    import("../../auth/password-hash-core.ts"),
    import("./hu-e1.test-fixtures.ts"),
    import("./carrito.service.ts"),
    import("./checkout.service.ts"),
    import("./pago-web.service.ts"),
    import("./pick-pack.service.ts"),
  ]);
  t.after(() => prisma.$disconnect());
  const { hash } = await hashPassword(PASSWORD_WEB);

  async function loginWeb(email: string) {
    const jar = new Jar();
    const login = await llamar(jar, "/api/tienda/cuenta/login", "POST", { email, password: PASSWORD_WEB });
    assert.equal(login.status, 200);
    return jar;
  }
  async function loginInterno(nombreUsuario: string) {
    const jar = new Jar();
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { nombre_usuario: nombreUsuario },
      select: { id: true, email: true },
    });
    const login = await llamar(jar, "/api/auth/login", "POST", { email: usuario.email, password: PASSWORD_INTERNO });
    assert.equal(login.status, 200);
    return { jar, usuario };
  }
  async function compraPagada() {
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 10, precio: 5000 });
    const cuenta = await fixtures.crearCuenta(prisma, { passwordHash: hash });
    await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 1 });
    const pedido = await checkout.iniciarCheckout(cuenta.sesion);
    const paymentId = `t11-${randomUUID()}`;
    const resultado = await pagoWeb.procesarNotificacionPago(paymentId, {
      consultarPago: async () => ({
        payment_id: paymentId,
        estado: "APROBADO",
        status_mp: "approved",
        status_detail: "accredited",
        monto: pedido.total,
        moneda: "ARS",
        external_reference: pedido.pedido_venta_ecommerce_id,
        fecha_aprobacion: new Date().toISOString(),
      }),
      cerrarCobro: async () => undefined,
    });
    assert.equal(resultado.resultado, "CONFIRMADO");
    for (let i = 0; i < 50; i++) {
      if (await prisma.ingresoTesoreria.count({ where: { pedido_venta_id: pedido.pedido_venta_id } })) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { ...pedido, cuenta, jar: await loginWeb(cuenta.email), paymentId };
  }

  const admin = await loginInterno("admin.ecommerce.seed");
  const operador = await loginInterno("operador.pickpack.seed");
  const rutaCliente = (id: string) => `/api/tienda/mis-pedidos/${id}/cancelar`;
  const rutaAdmin = (id: string) => `/api/ecommerce/pedidos/${id}/cancelar`;
  const rutaRetry = (id: string) => `/api/ecommerce/pedidos/${id}/reintegro/reintentar`;

  await t.test("pantalla T15 usa permiso propio y navegación separada de HU-E7", async () => {
    const paginaAdmin = await fetch(`${BASE_URL}/ecommerce/pedidos/pagados`, { headers: { cookie: admin.jar.header() }, redirect: "manual" });
    const html = await paginaAdmin.text();
    assert.equal(paginaAdmin.status, 200);
    assert.match(html, /Pedidos pagados/);
    assert.match(html, /href="\/ecommerce\/pedidos\/pagados"/);
    assert.match(html, /href="\/ecommerce\/pedidos"/);
    const paginaOperador = await fetch(`${BASE_URL}/ecommerce/pedidos/pagados`, { headers: { cookie: operador.jar.header() }, redirect: "manual" });
    assert.ok([307, 308].includes(paginaOperador.status));
    assert.match(paginaOperador.headers.get("location") ?? "", /\/no-autorizado/);
    const sinSesion = await fetch(`${BASE_URL}/ecommerce/pedidos/pagados`, { redirect: "manual" });
    assert.ok([307, 308].includes(sinSesion.status));
    assert.match(sinSesion.headers.get("location") ?? "", /\/login/);
  });

  await t.test("cliente: auth, validación, ownership, actor de sesión e idempotencia", async () => {
    const propio = await compraPagada();
    const ajeno = await compraPagada();
    assert.equal((await llamar(new Jar(), rutaCliente(propio.pedido_venta_id), "PATCH", { motivo: "Cambio" })).status, 401);
    assert.equal((await llamar(propio.jar, rutaCliente(propio.pedido_venta_id), "PATCH", { motivo: "   " })).status, 400);
    assert.equal((await llamar(ajeno.jar, rutaCliente(propio.pedido_venta_id), "PATCH", { motivo: "Intento ajeno" })).status, 404);
    assert.equal((await llamar(propio.jar, rutaCliente(propio.pedido_venta_id), "PATCH", {
      motivo: "Válido", cliente_web_cuenta_id: ajeno.cuenta.cuentaId,
    })).status, 400);
    const primera = await llamar(propio.jar, rutaCliente(propio.pedido_venta_id), "PATCH", { motivo: "Decisión cliente" });
    assert.equal(primera.status, 200);
    assert.deepEqual(primera.body, {
      data: {
        pedido_venta_id: propio.pedido_venta_id,
        estado_ecommerce: "CANCELADO",
        reintegro_iniciado: true,
      },
      error: null,
    });
    assert.doesNotMatch(JSON.stringify(primera.body), /reintegro_id|nota_credito_id|intento_id|payment|refund|clave|ultimo_error|g11/i);
    const sagaAntes = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: propio.pedido_venta_id } });
    const intentoAntes = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: sagaAntes.id } });
    assert.equal(intentoAntes.origen, "INICIAL");
    const segunda = await llamar(propio.jar, rutaCliente(propio.pedido_venta_id), "PATCH", { motivo: "Decisión cliente" });
    assert.equal(segunda.status, 200);
    assert.deepEqual(segunda.body, primera.body);
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: propio.pedido_venta_id } });
    assert.equal(saga.id, sagaAntes.id);
    assert.equal(saga.solicitado_por_tipo, "CLIENTE_WEB");
    assert.equal(saga.solicitado_por_id, null);
    assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: propio.pedido_venta_id } }), 1);
    const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: saga.id } });
    assert.equal(intentos.length, 1);
    assert.equal(intentos[0]?.id, intentoAntes.id);
    assert.equal(intentos[0]?.clave_idempotencia, intentoAntes.clave_idempotencia);
    const respuestaHistorica = await fetch(`${BASE_URL}/api/tienda/mis-pedidos/${propio.pedido_venta_id}`, {
      headers: { cookie: propio.jar.header() },
    });
    const historico = await respuestaHistorica.json();
    assert.equal(respuestaHistorica.status, 200);
    assert.equal(historico.data.estado, "CANCELADO");
    assert.equal(historico.data.qr_data_url, null);
  });

  await t.test("replay no ejecuta intento existente PENDIENTE/APROBADO ni altera backoff", async () => {
    const pendiente = await compraPagada();
    assert.equal((await llamar(admin.jar, rutaAdmin(pendiente.pedido_venta_id), "PATCH", { motivo: "Inicial" })).status, 200);
    const sagaPendiente = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pendiente.pedido_venta_id } });
    const intentoPendiente = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: sagaPendiente.id } });
    const retryFuturo = new Date(Date.now() + 60 * 60_000);
    await prisma.reintegroPedidoWeb.update({
      where: { id: sagaPendiente.id },
      data: { estado: "PENDIENTE", proximo_reintento_at: retryFuturo, ultimo_error_codigo: "MP_TIMEOUT" },
    });
    await prisma.reintegroRefundIntento.update({
      where: { id: intentoPendiente.id },
      data: { estado: "PENDIENTE", refund_id: null, intentos_tecnicos: 1, error_codigo: "MP_TIMEOUT" },
    });
    assert.equal((await llamar(admin.jar, rutaAdmin(pendiente.pedido_venta_id), "PATCH", { motivo: "Replay" })).status, 200);
    const pendienteDespues = await prisma.reintegroRefundIntento.findUniqueOrThrow({ where: { id: intentoPendiente.id } });
    assert.equal(pendienteDespues.clave_idempotencia, intentoPendiente.clave_idempotencia);
    assert.equal(pendienteDespues.intentos_tecnicos, 1);
    assert.equal((await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { id: sagaPendiente.id } })).proximo_reintento_at?.getTime(), retryFuturo.getTime());
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: sagaPendiente.id } }), 1);

    const aprobado = await compraPagada();
    assert.equal((await llamar(admin.jar, rutaAdmin(aprobado.pedido_venta_id), "PATCH", { motivo: "Inicial" })).status, 200);
    const sagaAprobada = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: aprobado.pedido_venta_id } });
    const intentoAprobado = await prisma.reintegroRefundIntento.findFirstOrThrow({ where: { reintegro_id: sagaAprobada.id } });
    await prisma.reintegroRefundIntento.update({ where: { id: intentoAprobado.id }, data: { estado: "APROBADO", refund_id: `T11-${randomUUID()}` } });
    await prisma.reintegroPedidoWeb.update({ where: { id: sagaAprobada.id }, data: { estado: "APROBADO", intento_aprobado_id: intentoAprobado.id, proximo_reintento_at: null, resuelto_at: new Date() } });
    assert.equal((await llamar(admin.jar, rutaAdmin(aprobado.pedido_venta_id), "PATCH", { motivo: "Replay" })).status, 200);
    assert.equal(await prisma.reintegroRefundIntento.count({ where: { reintegro_id: sagaAprobada.id } }), 1);
  });

  await t.test("cliente rechaza EN_PREPARACION y LISTO", async () => {
    for (const estado of ["EN_PREPARACION", "LISTO_PARA_RETIRO"] as const) {
      const pedido = await compraPagada();
      await prisma.pedidoVentaEcommerce.update({
        where: { pedido_venta_id: pedido.pedido_venta_id },
        data: estado === "EN_PREPARACION"
          ? { estado_ecommerce: estado }
          : { estado_ecommerce: estado, codigo_qr_retiro: `T11-${randomUUID()}`, plazo_retiro_vencimiento: new Date(Date.now() + 86_400_000) },
      });
      assert.equal((await llamar(pedido.jar, rutaCliente(pedido.pedido_venta_id), "PATCH", { motivo: "No permitido" })).status, 409);
      assert.equal(await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: pedido.pedido_venta_id } }), 0);
    }
  });

  await t.test("admin: permiso exacto, actor de sesión y tres estados", async () => {
    const sinPermiso = await compraPagada();
    assert.equal((await llamar(new Jar(), rutaAdmin(sinPermiso.pedido_venta_id), "PATCH", { motivo: "Admin" })).status, 401);
    assert.equal((await llamar(operador.jar, rutaAdmin(sinPermiso.pedido_venta_id), "PATCH", { motivo: "Admin" })).status, 403);
    for (const estado of ["PAGO_CONFIRMADO", "EN_PREPARACION", "LISTO_PARA_RETIRO"] as const) {
      const pedido = await compraPagada();
      if (estado !== "PAGO_CONFIRMADO") {
        await prisma.pedidoVentaEcommerce.update({
          where: { pedido_venta_id: pedido.pedido_venta_id },
          data: estado === "EN_PREPARACION"
            ? { estado_ecommerce: estado }
            : { estado_ecommerce: estado, codigo_qr_retiro: `T11-${randomUUID()}`, plazo_retiro_vencimiento: new Date(Date.now() + 86_400_000) },
        });
      }
      const respuesta = await llamar(admin.jar, rutaAdmin(pedido.pedido_venta_id), "PATCH", { motivo: `Admin ${estado}` });
      assert.equal(respuesta.status, 200);
      const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
      assert.equal(saga.solicitado_por_tipo, "USUARIO");
      assert.equal(saga.solicitado_por_id, admin.usuario.id);
      const intentos = await prisma.reintegroRefundIntento.findMany({ where: { reintegro_id: saga.id } });
      assert.equal(intentos.length, 1);
      assert.equal(intentos[0]?.origen, "INICIAL");
    }
    const impersonacion = await compraPagada();
    assert.equal((await llamar(admin.jar, rutaAdmin(impersonacion.pedido_venta_id), "PATCH", {
      motivo: "No impersonar", usuario_id: operador.usuario.id,
    })).status, 400);
  });

  await t.test("carreras cliente/admin contra toma se resuelven en dominio", async () => {
    const cliente = await compraPagada();
    const [cancelarCliente, tomarCliente] = await Promise.allSettled([
      llamar(cliente.jar, rutaCliente(cliente.pedido_venta_id), "PATCH", { motivo: "Carrera cliente" }),
      pickPack.tomarPedido(cliente.pedido_venta_id, operador.usuario.id),
    ]);
    const extCliente = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: cliente.pedido_venta_id } });
    const sagaCliente = await prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: cliente.pedido_venta_id } });
    if (cancelarCliente.status === "fulfilled" && cancelarCliente.value.status === 200) {
      assert.equal(tomarCliente.status, "rejected");
      assert.equal(extCliente.estado_ecommerce, "CANCELADO");
      assert.equal(extCliente.operador_asignado_id, null);
      assert.equal(sagaCliente, 1);
    } else {
      assert.equal(extCliente.estado_ecommerce, "EN_PREPARACION");
      assert.equal(extCliente.operador_asignado_id, operador.usuario.id);
      assert.equal(sagaCliente, 0);
    }

    const administrativo = await compraPagada();
    const [cancelarAdmin, tomarAdmin] = await Promise.allSettled([
      llamar(admin.jar, rutaAdmin(administrativo.pedido_venta_id), "PATCH", { motivo: "Carrera admin" }),
      pickPack.tomarPedido(administrativo.pedido_venta_id, operador.usuario.id),
    ]);
    assert.equal(cancelarAdmin.status, "fulfilled");
    assert.equal(cancelarAdmin.status === "fulfilled" && cancelarAdmin.value.status, 200);
    const extAdmin = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: administrativo.pedido_venta_id } });
    assert.equal(extAdmin.estado_ecommerce, "CANCELADO");
    assert.equal(extAdmin.operador_asignado_id, tomarAdmin.status === "fulfilled" ? operador.usuario.id : null);
  });

  await t.test("reintento: auth, permiso, actor/motivo y concurrencia", async () => {
    const pedido = await compraPagada();
    const cancelacion = await llamar(admin.jar, rutaAdmin(pedido.pedido_venta_id), "PATCH", { motivo: "Preparar rechazo" });
    assert.equal(cancelacion.status, 200);
    const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pedido.pedido_venta_id } });
    assert.equal(saga.estado, "RECHAZADO");
    assert.equal((await llamar(new Jar(), rutaRetry(pedido.pedido_venta_id), "POST", { motivo: "Retry" })).status, 401);
    assert.equal((await llamar(operador.jar, rutaRetry(pedido.pedido_venta_id), "POST", { motivo: "Retry" })).status, 403);
    assert.equal((await llamar(admin.jar, rutaRetry(pedido.pedido_venta_id), "POST", { motivo: "   " })).status, 400);
    assert.equal((await llamar(admin.jar, rutaRetry(pedido.pedido_venta_id), "POST", {
      motivo: "Retry", usuario_id: operador.usuario.id,
    })).status, 400);
    const [r1, r2] = await Promise.all([
      llamar(admin.jar, rutaRetry(pedido.pedido_venta_id), "POST", { motivo: "Ganador A" }),
      llamar(admin.jar, rutaRetry(pedido.pedido_venta_id), "POST", { motivo: "Ganador B" }),
    ]);
    assert.ok([200, 409].includes(r1.status));
    assert.ok([200, 409].includes(r2.status));
    const manuales = await prisma.reintegroRefundIntento.findMany({
      where: { reintegro_id: saga.id, origen: "REINTENTO_MANUAL" },
    });
    assert.equal(manuales.length, 1);
    assert.equal(manuales[0]?.creado_por_id, admin.usuario.id);
    assert.ok(["Ganador A", "Ganador B"].includes(manuales[0]?.motivo_reintento ?? ""));
    assert.doesNotMatch(JSON.stringify([r1.body, r2.body]), /clave_idempotencia|payment_id|refund_id|access_token/i);
  });
});
