import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/** T10: servidor Next y PostgreSQL descartable deben apuntar a la misma base. */
const BASE_URL = process.env.HU_E3_T10_INTEGRATION_BASE_URL;
const DATABASE_URL = process.env.HU_E3_T10_INTEGRATION_DATABASE_URL;
const PASSWORD_CLIENTE = "password-segura";
const OPERADOR_EMAIL = "operador.pickpack.seed@erp-swat.local";
const PASSWORD_INTERNO = "abc123456789";

class Jar {
  private readonly cookies = new Map<string, string>();

  absorber(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      if (rest.length) this.cookies.set(name.trim(), rest.join("="));
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function llamar(jar: Jar, ruta: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${ruta}`, {
    ...init,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie: jar.header(), ...(init.headers ?? {}) },
  });
  jar.absorber(response);
  const text = await response.text();
  return {
    status: response.status,
    body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null,
    text,
    response,
  };
}

async function esperar<T>(leer: () => Promise<T | null>, etiqueta: string): Promise<T> {
  for (let intento = 0; intento < 80; intento++) {
    const valor = await leer();
    if (valor !== null) return valor;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`No se materializó ${etiqueta}`);
}

test("HU-E3 T10: E8/E1/E2/E12/F3/E9/E3 con retiro validado real", {
  skip: !BASE_URL || !DATABASE_URL
    ? "Faltan HU_E3_T10_INTEGRATION_BASE_URL y HU_E3_T10_INTEGRATION_DATABASE_URL"
    : false,
  timeout: 300_000,
}, async (t) => {
  if (!BASE_URL || !DATABASE_URL) throw new Error("T10 requiere servidor y PostgreSQL descartable");
  const dbUrl = new URL(DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(dbUrl.protocol)) {
    throw new Error("T10 requiere PostgreSQL");
  }
  if (!/(test|integration|t10)/i.test(dbUrl.pathname)) {
    throw new Error("T10 requiere una base identificada como descartable");
  }
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
  t.after(async () => prisma.$disconnect());

  const { hash } = await hashPassword(PASSWORD_CLIENTE);
  const cuentaA = await fixtures.crearCuenta(prisma, { passwordHash: hash });
  const cuentaB = await fixtures.crearCuenta(prisma, { passwordHash: hash });
  const cuentaC = await fixtures.crearCuenta(prisma, { passwordHash: hash });
  const cuentaD = await fixtures.crearCuenta(prisma, { passwordHash: hash });

  async function login(ruta: string, body: object) {
    const jar = new Jar();
    const respuesta = await llamar(jar, ruta, { method: "POST", body: JSON.stringify(body) });
    assert.equal(respuesta.status, 200);
    return jar;
  }
  const [jarA, jarB, jarC, jarD, operador] = await Promise.all([
    login("/api/tienda/cuenta/login", { email: cuentaA.email, password: PASSWORD_CLIENTE }),
    login("/api/tienda/cuenta/login", { email: cuentaB.email, password: PASSWORD_CLIENTE }),
    login("/api/tienda/cuenta/login", { email: cuentaC.email, password: PASSWORD_CLIENTE }),
    login("/api/tienda/cuenta/login", { email: cuentaD.email, password: PASSWORD_CLIENTE }),
    login("/api/auth/login", { email: OPERADOR_EMAIL, password: PASSWORD_INTERNO }),
  ]);
  const [dniA, dniB, dniC, dniD] = await Promise.all(
    [cuentaA, cuentaB, cuentaC, cuentaD].map(async (cuenta) =>
      (await prisma.cliente.findUniqueOrThrow({
        where: { id: cuenta.clienteId }, select: { dni: true },
      })).dni),
  );

  async function comprarYConfirmar(cuenta: typeof cuentaA) {
    const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 5, precio: 10000 });
    await carrito.agregarAlCarrito(
      { cuentaId: cuenta.cuentaId },
      { variante_sku_id: articulo.varianteId, cantidad: 1 },
    );
    const iniciado = await checkout.iniciarCheckout(cuenta.sesion);
    const paymentId = `t10-${randomUUID()}`;
    const pago: PagoConsultado = {
      payment_id: paymentId,
      estado: "APROBADO",
      status_mp: "approved",
      status_detail: "accredited",
      monto: iniciado.total,
      moneda: "ARS",
      external_reference: iniciado.pedido_venta_ecommerce_id,
      fecha_aprobacion: new Date().toISOString(),
    };
    const resultado = await pagoWeb.procesarNotificacionPago(paymentId, {
      consultarPago: async (id: string) => {
        assert.equal(id, paymentId);
        return pago;
      },
      cerrarCobro: async () => undefined,
    });
    assert.equal(resultado.resultado, "CONFIRMADO");
    const admitido = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
      where: { pedido_venta_id: iniciado.pedido_venta_id },
      select: { estado_ecommerce: true, codigo_qr_retiro: true, plazo_retiro_vencimiento: true },
    });
    assert.equal(admitido.estado_ecommerce, "PAGO_CONFIRMADO");
    assert.ok(admitido.codigo_qr_retiro === null, "Antes de E12 no hay QR");
    assert.equal(admitido.plazo_retiro_vencimiento, null);
    return { ...iniciado, articulo };
  }

  async function preparar(pedido: Awaited<ReturnType<typeof comprarYConfirmar>>) {
    const id = pedido.pedido_venta_id;
    const tomar = await llamar(operador, `/api/ecommerce/preparacion/${id}/tomar`, {
      method: "POST", body: "{}",
    });
    assert.equal(tomar.status, 200);
    const scan = await llamar(operador, `/api/ecommerce/preparacion/${id}/scan`, {
      method: "POST",
      body: JSON.stringify({ scan_id: randomUUID(), codigo: pedido.articulo.sku }),
    });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.data.progreso.completo, true);
    const completar = await llamar(operador, `/api/ecommerce/preparacion/${id}/completar`, {
      method: "POST", body: "{}",
    });
    assert.equal(completar.status, 200);
    assert.equal(completar.body.data.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.equal(completar.body.data.transicion_realizada, true);
    assert.ok(!completar.text.includes("codigo_qr_retiro"), "E12 no expone el QR");
    const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({
      where: { pedido_venta_id: id },
      select: { id: true, estado_ecommerce: true, codigo_qr_retiro: true,
        plazo_retiro_vencimiento: true },
    });
    assert.equal(extension.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.ok(extension.codigo_qr_retiro, "E12 genera el token real");
    assert.ok(extension.plazo_retiro_vencimiento, "E12 genera el plazo real");
    assert.ok(!completar.text.includes(extension.codigo_qr_retiro), "E12 no revela el token");
    return extension;
  }

  async function retirar(token: string, dni: string) {
    return llamar(operador, "/api/ecommerce/preparacion/validar-retiro", {
      method: "POST", body: JSON.stringify({ qr_token: token, dni }),
    });
  }

  async function estado(pedidoId: string) {
    const [venta, extension, items] = await Promise.all([
      prisma.pedidoVenta.findUniqueOrThrow({
        where: { id: pedidoId }, select: { estado: true, numero_venta: true },
      }),
      prisma.pedidoVentaEcommerce.findUniqueOrThrow({
        where: { pedido_venta_id: pedidoId },
        select: { id: true, estado_ecommerce: true, codigo_qr_retiro: true,
          plazo_retiro_vencimiento: true },
      }),
      prisma.pedidoVentaItem.findMany({
        where: { pedido_venta_id: pedidoId, is_active: true, deleted_at: null },
        select: { cantidad: true, cantidad_facturada: true, cantidad_entregada: true },
      }),
    ]);
    return { venta, extension, items };
  }

  async function esperarAuditoria(accion: string, extensionId: string) {
    return esperar(() => prisma.auditLog.findFirst({
      where: { accion, tabla_afectada: "pedidos_venta_ecommerce", registro_id: extensionId },
      select: { usuario_id: true, valor_anterior: true, valor_nuevo: true, registro_id: true },
    }), `AuditLog ${accion}`);
  }

  async function esperarNotificacion(cuentaId: string, numeroVenta: string) {
    return esperar(() => prisma.notificacion.findFirst({
      where: {
        tipo_evento: "ecommerce:pedido_listo_para_retiro",
        cuenta_cliente_web_destinatario_id: cuentaId,
        cuerpo: { contains: numeroVenta },
      },
      select: { prioridad: true, cuerpo: true, cuenta_cliente_web_destinatario_id: true },
    }), "notificación interna LISTO");
  }

  await t.test("A y B inician sesión; E1/E2 admiten, E12 prepara, F3 avisa y E9 muestra QR propio", async () => {
    const pedidoA = await comprarYConfirmar(cuentaA);
    const extensionA = await preparar(pedidoA);
    const listo = await estado(pedidoA.pedido_venta_id);
    const tokenA = extensionA.codigo_qr_retiro!;
    const plazoA = extensionA.plazo_retiro_vencimiento!;
    const notificacion = await esperarNotificacion(cuentaA.cuentaId, listo.venta.numero_venta);
    assert.equal(notificacion.prioridad, "INFORMATIVA");
    assert.equal(notificacion.cuenta_cliente_web_destinatario_id, cuentaA.cuentaId);
    assert.equal(await prisma.notificacion.count({
      where: { tipo_evento: "ecommerce:pedido_listo_para_retiro",
        cuenta_cliente_web_destinatario_id: cuentaB.cuentaId },
    }), 0);

    const detalleA = await llamar(jarA, `/api/tienda/mis-pedidos/${pedidoA.pedido_venta_id}`);
    assert.equal(detalleA.status, 200);
    assert.equal(detalleA.body.data.estado, "LISTO_PARA_RETIRO");
    assert.ok(typeof detalleA.body.data.qr_data_url === "string"
      && detalleA.body.data.qr_data_url.startsWith("data:image/"), "E9 muestra imagen QR");
    assert.equal(detalleA.body.data.plazo_retiro_vencimiento, plazoA.toISOString());
    assert.ok(!detalleA.text.includes(tokenA), "E9 no devuelve el token literal");
    const detalleB = await llamar(jarB, `/api/tienda/mis-pedidos/${pedidoA.pedido_venta_id}`);
    assert.equal(detalleB.status, 404);
    assert.ok(!detalleB.text.includes(tokenA));

    // Segundo pedido del mismo titular: el QR determina exactamente cuál se entrega.
    const pedidoA2 = await comprarYConfirmar(cuentaA);
    const extensionA2 = await preparar(pedidoA2);
    await esperarNotificacion(cuentaA.cuentaId,
      (await estado(pedidoA2.pedido_venta_id)).venta.numero_venta);
    const entregarA2 = await retirar(extensionA2.codigo_qr_retiro!, dniA);
    assert.equal(entregarA2.status, 200);
    assert.equal(entregarA2.body.data.pedido_venta_id, pedidoA2.pedido_venta_id);
    assert.equal((await estado(pedidoA.pedido_venta_id)).extension.estado_ecommerce,
      "LISTO_PARA_RETIRO");
    assert.equal((await estado(pedidoA2.pedido_venta_id)).extension.estado_ecommerce, "ENTREGADO");

    const tercero = await retirar(tokenA, dniB);
    assert.equal(tercero.status, 422);
    assert.ok(JSON.stringify(tercero.body) === JSON.stringify({
      data: null, error: { code: "RETIRO_NO_VALIDO", message: "No fue posible validar el retiro" },
    }), "El tercero recibe solo el rechazo genérico");
    assert.ok(!tercero.text.includes(tokenA));
    assert.ok(!tercero.text.includes(dniB));
    assert.doesNotMatch(tercero.text, /DNI_NO_COINCIDE|pedido_venta_id|pedido_venta_ecommerce_id/);
    assert.equal((await estado(pedidoA.pedido_venta_id)).venta.estado, "FACTURADO");
    assert.equal((await estado(pedidoA.pedido_venta_id)).extension.estado_ecommerce,
      "LISTO_PARA_RETIRO");
    const auditRechazo = await esperarAuditoria("RETIRO_RECHAZADO", extensionA.id);
    assert.equal(auditRechazo.registro_id, extensionA.id);
    assert.ok(!JSON.stringify(auditRechazo).includes(tokenA));
    assert.ok(!JSON.stringify(auditRechazo).includes(dniB));

    const entrega = await retirar(tokenA, dniA);
    assert.equal(entrega.status, 200);
    assert.ok(JSON.stringify(entrega.body) === JSON.stringify({
      data: { pedido_venta_id: pedidoA.pedido_venta_id,
        numero: listo.venta.numero_venta, estado: "ENTREGADO" },
      error: null,
    }), "La entrega devuelve únicamente el DTO aprobado");
    const final = await estado(pedidoA.pedido_venta_id);
    assert.equal(final.venta.estado, "CERRADO");
    assert.equal(final.extension.estado_ecommerce, "ENTREGADO");
    assert.ok(final.extension.codigo_qr_retiro === null, "QR consumido tras entregar");
    assert.deepEqual(final.extension.plazo_retiro_vencimiento, plazoA);
    assert.ok(final.items.length > 0);
    assert.ok(final.items.every((item) =>
      item.cantidad_entregada === item.cantidad_facturada
      && item.cantidad_facturada === item.cantidad));
    const auditEntrega = await esperarAuditoria("PEDIDO_ENTREGADO", extensionA.id);
    const previoEntrega = auditEntrega.valor_anterior as Record<string, unknown>;
    assert.deepEqual({
      estado_ecommerce: previoEntrega.estado_ecommerce,
      estado_pedido_venta: previoEntrega.estado_pedido_venta,
    }, {
      estado_ecommerce: "LISTO_PARA_RETIRO", estado_pedido_venta: "FACTURADO",
    });
    const efectoEntrega = auditEntrega.valor_nuevo as Record<string, unknown>;
    assert.deepEqual({
      estado_ecommerce: efectoEntrega.estado_ecommerce,
      estado_pedido_venta: efectoEntrega.estado_pedido_venta,
      qr_consumido: efectoEntrega.qr_consumido,
      entrega_total: efectoEntrega.entrega_total,
    }, {
      estado_ecommerce: "ENTREGADO", estado_pedido_venta: "CERRADO",
      qr_consumido: true, entrega_total: true,
    });
    assert.ok(!JSON.stringify(auditEntrega).includes(tokenA));
    assert.ok(!JSON.stringify(auditEntrega).includes(dniA));

    const reuso = await retirar(tokenA, dniA);
    assert.equal(reuso.status, 422);
    assert.ok(JSON.stringify(reuso.body) === JSON.stringify(tercero.body),
      "El QR usado recibe el mismo rechazo genérico");
    assert.ok(!reuso.text.includes(tokenA));
    assert.ok(!reuso.text.includes(dniA));
    assert.equal(await prisma.auditLog.count({
      where: { accion: "PEDIDO_ENTREGADO", registro_id: extensionA.id },
    }), 1);
    assert.equal(await prisma.notificacion.count({
      where: { tipo_evento: "ecommerce:pedido_entregado" },
    }), 0);

    const despuesE9 = await llamar(jarA,
      `/api/tienda/mis-pedidos/${pedidoA.pedido_venta_id}`);
    assert.equal(despuesE9.status, 200);
    assert.equal(despuesE9.body.data.estado, "ENTREGADO");
    assert.ok(despuesE9.body.data.qr_data_url === null, "E9 deja de mostrar QR");
  });

  await t.test("cuentas inactiva y eliminada no reciben F3 pero conservan retiro físico", async () => {
    for (const [cuenta, dni, jar, eliminada] of [
      [cuentaB, dniB, jarB, false],
      [cuentaC, dniC, jarC, true],
    ] as const) {
      const pedido = await comprarYConfirmar(cuenta);
      await prisma.cuentaClienteWeb.update({
        where: { id: cuenta.cuentaId },
        data: { is_active: false, deleted_at: eliminada ? new Date() : null },
      });
      const extension = await preparar(pedido);
      await esperarAuditoria("PEDIDO_LISTO_PARA_RETIRO", extension.id);
      assert.equal(await prisma.notificacion.count({
        where: { tipo_evento: "ecommerce:pedido_listo_para_retiro",
          cuenta_cliente_web_destinatario_id: cuenta.cuentaId },
      }), 0);
      const respuesta = await retirar(extension.codigo_qr_retiro!, dni);
      assert.equal(respuesta.status, 200);
      assert.equal((await estado(pedido.pedido_venta_id)).venta.estado, "CERRADO");
      assert.equal((await estado(pedido.pedido_venta_id)).extension.estado_ecommerce, "ENTREGADO");
      assert.equal(await prisma.notificacion.count({
        where: { tipo_evento: "ecommerce:pedido_entregado",
          cuenta_cliente_web_destinatario_id: cuenta.cuentaId },
      }), 0);
      // El login E8 se realizó mientras la cuenta todavía era operable.
      assert.ok(jar.header());
    }
  });

  await t.test("plazo vencido rechaza sin entregar ni consumir QR", async () => {
    const pedido = await comprarYConfirmar(cuentaD);
    const extension = await preparar(pedido);
    const token = extension.codigo_qr_retiro!;
    // Caso límite aislado: E12 generó el plazo; se fuerza solo su expiración
    // después de LISTO, sin fijar manualmente estado/token/plazo del flujo principal.
    await prisma.pedidoVentaEcommerce.update({
      where: { id: extension.id },
      data: { plazo_retiro_vencimiento: new Date(Date.now() - 1000) },
    });
    const respuesta = await retirar(token, dniD);
    assert.equal(respuesta.status, 422);
    assert.ok(JSON.stringify(respuesta.body) === JSON.stringify({
      data: null, error: { code: "RETIRO_NO_VALIDO", message: "No fue posible validar el retiro" },
    }), "El plazo vencido recibe solo el rechazo genérico");
    assert.ok(!respuesta.text.includes(token));
    assert.ok(!respuesta.text.includes(dniD));
    const persistido = await estado(pedido.pedido_venta_id);
    assert.equal(persistido.venta.estado, "FACTURADO");
    assert.equal(persistido.extension.estado_ecommerce, "LISTO_PARA_RETIRO");
    assert.ok(persistido.extension.codigo_qr_retiro === token,
      "El rechazo por plazo conserva el QR");
    assert.ok(persistido.items.every((item) => item.cantidad_entregada === 0));
    const rechazo = await esperarAuditoria("RETIRO_RECHAZADO", extension.id);
    assert.equal((rechazo.valor_nuevo as Record<string, unknown>).motivo, "PLAZO_VENCIDO");
    assert.ok(!JSON.stringify(rechazo).includes(token));
    assert.ok(!JSON.stringify(rechazo).includes(dniD));
    assert.ok(jarD.header());
  });

  // Cierre eventual del listener post-commit: ninguno de los casos sin cuenta
  // operable recibió LISTO, y ENTREGADO no tiene suscripción F3.
  for (const cuenta of [cuentaB, cuentaC]) {
    assert.equal(await prisma.notificacion.count({
      where: { tipo_evento: "ecommerce:pedido_listo_para_retiro",
        cuenta_cliente_web_destinatario_id: cuenta.cuentaId },
    }), 0);
  }
  assert.equal(await prisma.notificacion.count({
    where: { tipo_evento: "ecommerce:pedido_entregado" },
  }), 0);
});
