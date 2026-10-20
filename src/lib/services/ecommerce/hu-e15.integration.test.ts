import assert from "node:assert/strict";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/**
 * HU-E15 — Nivel 2: claridad en checkout y reserva de stock contra una base
 * REAL descartable (docs/modulos/modulo E/HU15_TASKS.md T03/T07). Mismo arnés
 * que `hu-e7.integration.test.ts`: pasarela de Mercado Pago FALSA inyectada y
 * `MP_MODO=simulado`, sin red. `skip` sin `HU_E15_INTEGRATION_DATABASE_URL`.
 *
 *   HU_E15_INTEGRATION_DATABASE_URL=postgresql://erpswat:erpswat@localhost:5432/swat_erp_test_e15?schema=public \
 *     npm run test:integration:e15
 *
 * Las órdenes se crean con el checkout real (E1/E2). Única escritura directa,
 * deliberada: mover `Reserva.fecha_expiracion` al pasado para simular el
 * vencimiento (mismo criterio que HU-E7). Nunca se borra nada (Regla N.° 1).
 */

const DATABASE_URL = process.env.HU_E15_INTEGRATION_DATABASE_URL;

// IDs fijos de prisma/seed.ts.
const USUARIO_ADMIN_ECOMMERCE_SEED_ID = "ff9df5a6-2f1a-4285-a935-c6969f933f1a";
const PEDIDO_MOSTRADOR_RESERVADO_SEED_ID = "1a2b3c4d-be02-4a1a-8a1a-000000000002";

test(
  "HU-E15 — checkout claro y reserva de stock contra una base real",
  { skip: !DATABASE_URL, timeout: 600_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MP_MODO = "simulado";
    process.env.APP_PUBLIC_URL ??= "http://localhost:3000";

    const [
      { prisma },
      anulacion,
      reglas,
      listener,
      carrito,
      checkout,
      pagoWeb,
      mantenimiento,
      { listenersRegistrados },
      { ServiceError },
      { obtenerUsuarioCanalWebId },
      fixtures,
    ] = await Promise.all([
      import("../../db/prisma.ts"),
      import("./anulacion-orden.service.ts"),
      import("./anulacion-orden.reglas.ts"),
      import("../../events/listeners/anulacion-orden.listener.ts"),
      import("./carrito.service.ts"),
      import("./checkout.service.ts"),
      import("./pago-web.service.ts"),
      import("./mantenimiento-programado.ts"),
      import("../../events/domain-event-bus.ts"),
      import("../../errors/service-error.ts"),
      import("./usuario-canal-web.ts"),
      import("./hu-e1.test-fixtures.ts"),
    ]);
    const reglasPedido = await import("./pedido-web.reglas.ts");
    const { IniciarCheckoutSchema } = await import("../../schemas/ecommerce.schema.ts");
    // Asientos de auditoría fire-and-forget: se espera a que la cola se vacíe (molde HU-E7).
    t.after(async () => {
      await listener.esperarAnulacionesPendientes();
      let anterior = -1;
      for (let intento = 0; intento < 60; intento++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) break;
        anterior = actual;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await prisma.$disconnect();
    });

    // Evidencia de aislamiento: nunca correr contra una base que no sea de test.
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    console.log(`[hu-e15] current_database() = ${db}`);

    await listenersRegistrados;
    const CANAL_WEB = await obtenerUsuarioCanalWebId();

    // ── Pasarela falsa (mismo arnés que HU-E2/E7) ────────────────────────────
    const pagosMp = new Map<string, PagoConsultado>();
    const pasarela = {
      consultarPago: async (id: string) => {
        const pago = pagosMp.get(id);
        if (!pago) throw new ServiceError("PAGO_NO_ENCONTRADO");
        return pago;
      },
      cerrarCobro: async () => {},
    };
    function pagoMp(ref: string, estado: "approved" | "rejected", monto: number): string {
      const id = String(Math.floor(Math.random() * 1e12));
      pagosMp.set(id, {
        payment_id: id,
        estado: estado === "approved" ? "APROBADO" : "RECHAZADO",
        status_mp: estado,
        status_detail: estado === "approved" ? "accredited" : "cc_rejected_insufficient_amount",
        monto,
        moneda: "ARS",
        external_reference: ref,
        fecha_aprobacion: estado === "approved" ? new Date().toISOString() : null,
      });
      return id;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    /** Orden web real (carrito + checkout de E1/E2). */
    async function compra(opciones: { cantidad?: number; cupon?: string; cuenta?: Awaited<ReturnType<typeof fixtures.crearCuenta>> } = {}) {
      const cuenta = opciones.cuenta ?? (await fixtures.crearCuenta(prisma));
      const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 5, precio: 10000 });
      await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: opciones.cantidad ?? 1 });
      const iniciado = await checkout.iniciarCheckout(cuenta.sesion, opciones.cupon ? { cupon_codigo: opciones.cupon } : {});
      return { cuenta, articulo, iniciado, pv: iniciado.pedido_venta_id };
    }

    /** Vence las reservas de una orden (solo `fecha_expiracion`, criterio HU-E7). */
    async function vencerReservas(pedidoVentaId: string, haceMs = 60_000) {
      const items = await prisma.pedidoVentaItem.findMany({ where: { pedido_venta_id: pedidoVentaId }, select: { reserva_id: true } });
      const ids = items.map((i) => i.reserva_id).filter((id): id is string => id !== null);
      const vencimiento = new Date(Date.now() - haceMs);
      await prisma.reserva.updateMany({ where: { id: { in: ids } }, data: { fecha_expiracion: vencimiento } });
      return vencimiento;
    }

    /** Job real de TTL (Módulo A) + anulación automática de HU-E7. */
    async function correrJobTtl() {
      const resultado = await mantenimiento.ejecutarMantenimientoProgramado(new Date());
      assert.equal(resultado.reservas.ok, true);
      await listener.esperarAnulacionesPendientes();
    }

    const huella = async (pedidoVentaId: string) => {
      const pv = await prisma.pedidoVenta.findUniqueOrThrow({
        where: { id: pedidoVentaId },
        include: { ecommerce: true, items: { include: { reserva: true } } },
      });
      return JSON.stringify({
        pv: [pv.estado, pv.is_active, pv.updated_at.toISOString(), pv.total.toString()],
        ext: [pv.ecommerce?.estado_ecommerce, pv.ecommerce?.is_active, pv.ecommerce?.updated_at.toISOString()],
        reservas: pv.items.map((i) => [i.reserva?.fecha_expiracion.toISOString(), i.reserva?.fecha_fin_reserva?.toISOString() ?? null, i.reserva?.updated_at.toISOString()]),
      });
    };

    // ── T03 — Lectura del pedido vencido post-job (E15-7, D7/P6) ─────────────
    await t.test("T03.1 — post-job: las lecturas por defecto no lo ven; la lectura acotada devuelve RESERVA_VENCIDA", async () => {
      const { cuenta, iniciado, pv } = await compra({ cantidad: 2 });
      const vencimiento = await vencerReservas(pv);
      await correrJobTtl();

      const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pv } });
      assert.equal(ext.estado_ecommerce, "ANULADO", "precondición: el job de HU-E7 anuló la orden");
      assert.equal(ext.deletion_reason, reglas.MOTIVO_ANULACION_TTL);
      assert.equal(ext.deleted_by, CANAL_WEB);

      // Brecha relevada en el PASO 0 (HU15_MODULO_E.md §2.d).
      assert.equal(await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId), null);
      assert.equal(await pagoWeb.obtenerResultadoPago(pv, cuenta.clienteId), null);

      const antes = await huella(pv);
      const vista = await checkout.obtenerPedidoWebVencidoPorTtl(pv, cuenta.clienteId, CANAL_WEB);
      assert.ok(vista, "la lectura acotada encuentra el pedido anulado por TTL");
      assert.equal(vista.estado_visible, "RESERVA_VENCIDA");
      assert.equal(vista.pedido_venta_id, pv);
      assert.equal(vista.numero_venta, iniciado.numero_venta);
      assert.equal(vista.total, iniciado.total, "mismo PedidoVenta.total");
      assert.equal(vista.checkout_url, null, "sin enlace de pago");
      assert.equal(vista.cupon, null);
      assert.equal(vista.ttl_expiracion, vencimiento.toISOString(), "mismo vencimiento que antes del job");
      assert.equal(await huella(pv), antes, "solo lectura: ninguna fila cambia");
    });

    await t.test("T03.2 — otro cliente: null (sin revelar pedidos ajenos)", async () => {
      const { pv } = await compra();
      await vencerReservas(pv);
      await correrJobTtl();
      const ajeno = await fixtures.crearCuenta(prisma);
      assert.equal(await checkout.obtenerPedidoWebVencidoPorTtl(pv, ajeno.clienteId, CANAL_WEB), null);
    });

    await t.test("T03.3 — anulación MANUAL con el mismo motivo literal: null (la firma el Administrador, no Canal Web)", async () => {
      const { cuenta, pv } = await compra();
      await anulacion.anularOrdenNoAbonada(pv, USUARIO_ADMIN_ECOMMERCE_SEED_ID, reglas.MOTIVO_ANULACION_TTL);
      const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pv } });
      assert.equal(ext.estado_ecommerce, "ANULADO");
      assert.equal(ext.deletion_reason, reglas.MOTIVO_ANULACION_TTL);
      assert.equal(ext.deleted_by, USUARIO_ADMIN_ECOMMERCE_SEED_ID);
      assert.equal(await checkout.obtenerPedidoWebVencidoPorTtl(pv, cuenta.clienteId, CANAL_WEB), null);
    });

    await t.test("T03.4 — pago rechazado (no anulado por TTL): null", async () => {
      const { cuenta, iniciado, pv } = await compra();
      const pid = pagoMp(iniciado.pedido_venta_ecommerce_id, "rejected", iniciado.total);
      assert.equal((await pagoWeb.procesarNotificacionPago(pid, pasarela)).resultado, "RECHAZADO");
      assert.equal(await checkout.obtenerPedidoWebVencidoPorTtl(pv, cuenta.clienteId, CANAL_WEB), null);
    });

    await t.test("T03.5 — pedido vigente (no anulado) y pedido de mostrador: null", async () => {
      const { cuenta, pv } = await compra();
      assert.equal(await checkout.obtenerPedidoWebVencidoPorTtl(pv, cuenta.clienteId, CANAL_WEB), null);
      const mostrador = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: PEDIDO_MOSTRADOR_RESERVADO_SEED_ID } });
      assert.equal(mostrador.canal, "MOSTRADOR");
      assert.equal(await checkout.obtenerPedidoWebVencidoPorTtl(mostrador.id, mostrador.cliente_id ?? "", CANAL_WEB), null);
    });

    // ── T07 — casos mínimos de spec §6.1 a nivel servicio ────────────────────
    await t.test("T07.1 — E15-5: con cupón, el total congelado (neto) es el mismo en la respuesta, en cada recarga y en PedidoVenta", async () => {
      const codigo = `E15${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await prisma.cuponDescuento.create({
        data: {
          codigo,
          tipo_beneficio: "PORCENTAJE",
          valor: 10,
          vigente_desde: new Date(Date.now() - 86_400_000),
          vigente_hasta: new Date(Date.now() + 86_400_000),
          limite_uso_por_cliente: 5,
        },
      });
      const { cuenta, iniciado, pv } = await compra({ cantidad: 2, cupon: codigo });
      assert.equal(iniciado.total, 18_000, "2 × 10.000 − 10 %");

      const antes = await huella(pv);
      const primera = await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId);
      const recarga = await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId);
      const persistido = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pv }, select: { total: true } });
      assert.ok(primera && recarga);
      assert.equal(primera.total, iniciado.total);
      assert.equal(recarga.total, iniciado.total);
      assert.equal(persistido.total.toNumber(), iniciado.total);
      assert.deepEqual(primera.cupon, { codigo, monto_descontado: 2_000, subtotal: 20_000 });
      assert.equal(primera.ttl_expiracion, iniciado.ttl_expiracion);
      assert.equal(await huella(pv), antes, "leer la pantalla (o recargarla) no muta nada");
    });

    await t.test("T07.2 — E15-4/E15-7: bordes del TTL antes / en / después (mismo criterio en vista y diálogo)", async () => {
      const { cuenta, iniciado, pv } = await compra();
      const ttl = new Date(iniciado.ttl_expiracion);
      const en = (ms: number) => new Date(ttl.getTime() + ms);
      assert.equal((await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId, en(-1)))?.estado_visible, "PAGO_PENDIENTE");
      assert.equal((await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId, en(0)))?.estado_visible, "RESERVA_VENCIDA");
      assert.equal((await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId, en(1)))?.estado_visible, "RESERVA_VENCIDA");
      assert.equal(reglasPedido.minutosRestantesReserva(ttl, en(-1)), 1);
      assert.ok(reglasPedido.minutosRestantesReserva(ttl, en(0)) <= 0);
      assert.ok(reglasPedido.minutosRestantesReserva(ttl, en(1)) <= 0);
      const plazo = await checkout.obtenerPlazoReservaCheckoutMinutos();
      const horas = Number((await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_CHECKOUT_TTL_HORAS" } })).valor);
      assert.equal(plazo, horas * 60, "el carrito informa el mismo plazo que usa la reserva");
      assert.equal(reglasPedido.minutosRestantesReserva(ttl, new Date(ttl.getTime() - horas * 3_600_000)), plazo);
    });

    await t.test("T07.3 — E15-7 pre-job: con la reserva vencida y el job sin correr se ve RESERVA_VENCIDA; el estado persistido no cambia", async () => {
      const { cuenta, pv } = await compra();
      await vencerReservas(pv);
      const vista = await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId);
      assert.equal(vista?.estado_visible, "RESERVA_VENCIDA");
      const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pv } });
      assert.equal(ext.estado_ecommerce, "PAGO_PENDIENTE");
      assert.equal(ext.is_active, true);
    });

    await t.test("T07.4 — E15-6: enlace ausente → checkout_url null en la lectura; el reintento de E2 crea UNA preferencia", async () => {
      const cuenta = await fixtures.crearCuenta(prisma);
      const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 5, precio: 10000 });
      await carrito.agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: 1 });
      const appPublicUrl = process.env.APP_PUBLIC_URL;
      delete process.env.APP_PUBLIC_URL;
      let pv = "";
      try {
        await assert.rejects(checkout.iniciarCheckout(cuenta.sesion, {}), (e: unknown) => {
          const error = e as { code?: string; details?: { pedido_venta_id?: string } };
          pv = error.details?.pedido_venta_id ?? "";
          return error.code === "APP_PUBLIC_URL_NO_CONFIGURADA";
        });
      } finally {
        process.env.APP_PUBLIC_URL = appPublicUrl;
      }
      assert.ok(pv, "el pedido quedó Pago Pendiente sin preferencia");
      const sinEnlace = await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId);
      assert.equal(sinEnlace?.checkout_url, null, "la vista mostrará el aviso de reintento (sin diálogo)");
      assert.equal(sinEnlace?.estado_visible, "PAGO_PENDIENTE");

      const reintento = await pagoWeb.obtenerOCrearPreferencia(sinEnlace!.pedido_venta_ecommerce_id);
      assert.ok(reintento, "recargar la página crea la preferencia faltante (E2)");
      assert.equal(await pagoWeb.obtenerOCrearPreferencia(sinEnlace!.pedido_venta_ecommerce_id), reintento, "no crea una segunda");
      assert.equal((await checkout.obtenerPedidoWebPendiente(pv, cuenta.clienteId))?.checkout_url, reintento);
    });

    await t.test("T07.5 — E15-3/E15-5: el body del checkout no acepta medio de pago ni importe (contrato E2 sin cambios)", async () => {
      assert.equal(IniciarCheckoutSchema.safeParse({}).success, true);
      assert.equal(IniciarCheckoutSchema.safeParse({ cupon_codigo: "SWAT10" }).success, true);
      assert.equal(IniciarCheckoutSchema.safeParse({ medio_pago: "MERCADO_PAGO" }).success, false);
      assert.equal(IniciarCheckoutSchema.safeParse({ total: 1 }).success, false);
      assert.equal(IniciarCheckoutSchema.safeParse({ medio_pago: "TARJETA", cupon_codigo: "SWAT10" }).success, false);
    });
  },
);

// ── T07 — casos mínimos de spec §6.1 por HTTP (servidor real) ───────────────
//
// Requiere un servidor aparte sobre la MISMA base (ver HU15_TASKS.md §4.2):
//   DATABASE_URL=$TEST_DB MP_MODO=simulado APP_PUBLIC_URL=http://localhost:3101 npx next dev -p 3101
//   HU_E15_INTEGRATION_BASE_URL=http://localhost:3101 HU_E15_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e15

const BASE_URL = process.env.HU_E15_INTEGRATION_BASE_URL;
const PASSWORD = "password-segura-e15";

class Jar {
  private readonly cookies = new Map<string, string>();
  absorber(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
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
  const esJson = response.headers.get("content-type")?.includes("json");
  const body = esJson ? await response.json() : null;
  const html = esJson ? "" : await response.text();
  return { status: response.status, body, html, response };
}

test(
  "HU-E15 HTTP — carrito, checkout y pago pendiente con sesión, sin sesión y con cuenta pendiente",
  { skip: !BASE_URL || !DATABASE_URL, timeout: 600_000 },
  async (t) => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.MP_MODO = "simulado";
    const [{ prisma }, { hashPassword }, fixtures, listener, mantenimiento, { listenersRegistrados }, { formatearPrecio }] =
      await Promise.all([
        import("../../db/prisma.ts"),
        import("../../auth/password-hash-core.ts"),
        import("./hu-e1.test-fixtures.ts"),
        import("../../events/listeners/anulacion-orden.listener.ts"),
        import("./mantenimiento-programado.ts"),
        import("../../events/domain-event-bus.ts"),
        import("../../../components/tienda/formato.ts"),
      ]);
    t.after(async () => {
      await listener.esperarAnulacionesPendientes();
      let anterior = -1;
      for (let intento = 0; intento < 60; intento++) {
        const actual = await prisma.auditLog.count();
        if (actual === anterior) break;
        anterior = actual;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await prisma.$disconnect();
    });
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    assert.match(db, /test/i, `la base ${db} no parece de test`);
    await listenersRegistrados;
    const { hash } = await hashPassword(PASSWORD);

    async function cuentaConSesion(pendiente = false) {
      const cuenta = await fixtures.crearCuenta(prisma, { vinculacionPendiente: pendiente, passwordHash: hash });
      const jar = new Jar();
      const login = await llamar(jar, "/api/tienda/cuenta/login", {
        method: "POST",
        body: JSON.stringify({ email: cuenta.email, password: PASSWORD }),
      });
      assert.equal(login.status, 200);
      return { cuenta, jar };
    }
    async function agregarArticulo(jar: Jar, cantidad = 1) {
      const articulo = await fixtures.crearArticulo(prisma, { stockShowroom: 5, precio: 10000 });
      const r = await llamar(jar, "/api/tienda/carrito/items", {
        method: "POST",
        body: JSON.stringify({ variante_sku_id: articulo.varianteId, cantidad }),
      });
      assert.equal(r.status, 201);
      return articulo;
    }
    const sinFugasDeTtl = (html: string) => {
      assert.doesNotMatch(html, /ECOMMERCE_CHECKOUT_TTL_HORAS/);
      assert.doesNotMatch(html, /\d+\s*horas?\b/i, "las horas nunca llegan al navegador");
    };
    const plazoMinutos = async () =>
      Number((await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_CHECKOUT_TTL_HORAS" } })).valor) * 60;
    async function huella(pedidoVentaId: string) {
      const pv = await prisma.pedidoVenta.findUniqueOrThrow({
        where: { id: pedidoVentaId },
        include: { ecommerce: true, items: { include: { reserva: true } } },
      });
      return JSON.stringify({
        pv: [pv.estado, pv.is_active, pv.updated_at.toISOString(), pv.total.toString()],
        ext: [pv.ecommerce?.estado_ecommerce, pv.ecommerce?.updated_at.toISOString(), pv.ecommerce?.mercadopago_preference_id],
        reservas: pv.items.map((i) => [i.reserva?.fecha_expiracion.toISOString(), i.reserva?.updated_at.toISOString()]),
      });
    }
    async function vencerReservas(pedidoVentaId: string) {
      const items = await prisma.pedidoVentaItem.findMany({ where: { pedido_venta_id: pedidoVentaId }, select: { reserva_id: true } });
      const ids = items.map((i) => i.reserva_id).filter((id): id is string => id !== null);
      await prisma.reserva.updateMany({ where: { id: { in: ids } }, data: { fecha_expiracion: new Date(Date.now() - 60_000) } });
    }

    await t.test("H1 — visitante: «Ingresar para comprar», plazo en minutos sin horas ni clave; checkout 401", async () => {
      const jar = new Jar();
      await agregarArticulo(jar);
      const pagina = await llamar(jar, "/tienda/carrito");
      assert.equal(pagina.status, 200);
      assert.match(pagina.html, /Ingresar para comprar/);
      assert.doesNotMatch(pagina.html, /Proceder al pago|Iniciar compra/);
      assert.match(pagina.html, new RegExp(`durante ${await plazoMinutos()} minutos`));
      sinFugasDeTtl(pagina.html);
      const checkoutSinSesion = await llamar(jar, "/api/tienda/checkout", { method: "POST", body: "{}" });
      assert.equal(checkoutSinSesion.status, 401);
      assert.equal(checkoutSinSesion.body.error.code, "SESION_CLIENTE_WEB_REQUERIDA");
    });

    await t.test("H2 — cuenta pendiente: sin acción de checkout, texto genérico, checkout 403 y pago pendiente redirige a /tienda/cuenta", async () => {
      const { jar } = await cuentaConSesion(true);
      await agregarArticulo(jar);
      const pagina = await llamar(jar, "/tienda/carrito");
      assert.equal(pagina.status, 200);
      assert.doesNotMatch(pagina.html, /Proceder al pago|Ingresar para comprar|Iniciar compra/);
      assert.match(pagina.html, /por un tiempo limitado/);
      assert.match(pagina.html, /href="\/tienda\/cuenta"/);
      const checkout = await llamar(jar, "/api/tienda/checkout", { method: "POST", body: "{}" });
      assert.equal(checkout.status, 403);
      assert.equal(checkout.body.error.code, "CUENTA_VINCULACION_PENDIENTE");
      const pendiente = await llamar(jar, `/tienda/checkout/pendiente?pedido=${crypto.randomUUID()}`);
      assert.ok([303, 307].includes(pendiente.status));
      assert.match(pendiente.response.headers.get("location") ?? "", /\/tienda\/cuenta$/);
    });

    await t.test("H3 — sesión vinculada: «Proceder al pago» + minutos; body sin medio ni importe; pago pendiente con selector, diálogo y total congelado", async () => {
      const { jar } = await cuentaConSesion();
      await agregarArticulo(jar, 2);
      const carrito = await llamar(jar, "/tienda/carrito");
      assert.match(carrito.html, /Proceder al pago/);
      assert.match(carrito.html, new RegExp(`durante ${await plazoMinutos()} minutos`));
      sinFugasDeTtl(carrito.html);

      for (const cuerpo of [{ medio_pago: "TARJETA" }, { total: 1 }]) {
        const r = await llamar(jar, "/api/tienda/checkout", { method: "POST", body: JSON.stringify(cuerpo) });
        assert.equal(r.status, 400, `rechaza ${JSON.stringify(cuerpo)}`);
      }
      const iniciado = await llamar(jar, "/api/tienda/checkout", { method: "POST", body: "{}" });
      assert.equal(iniciado.status, 201);
      const { pedido_venta_id: pv, total, checkout_url } = iniciado.body.data;
      assert.ok(checkout_url);
      assert.equal(total, 20_000);

      const antes = await huella(pv);
      const pendiente = await llamar(jar, `/tienda/checkout/pendiente?pedido=${pv}`);
      const recarga = await llamar(jar, `/tienda/checkout/pendiente?pedido=${pv}`);
      for (const pagina of [pendiente, recarga]) {
        assert.equal(pagina.status, 200);
        assert.match(pagina.html, /Medio de pago/);
        assert.match(pagina.html, /value="MERCADO_PAGO"/);
        assert.match(pagina.html, /Incluye tarjeta de crédito y débito dentro del checkout de Mercado Pago/);
        assert.match(pagina.html, /Pagar con Mercado Pago/);
        assert.ok(pagina.html.includes(formatearPrecio(total)), "el total mostrado es el congelado");
        assert.doesNotMatch(pagina.html, /No pudimos conectar con Mercado Pago/);
        sinFugasDeTtl(pagina.html);
      }
      const persistido = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: pv }, select: { total: true } });
      assert.equal(persistido.total.toNumber(), total, "respuesta 201 = PedidoVenta.total");
      assert.equal(await huella(pv), antes, "abrir/recargar la pantalla no muta pedido, extensión ni reservas");
    });

    await t.test("H4 — E15-7: «Reserva vencida» antes del job y después de que el job anula el pedido", async () => {
      const { jar } = await cuentaConSesion();
      await agregarArticulo(jar);
      const iniciado = await llamar(jar, "/api/tienda/checkout", { method: "POST", body: "{}" });
      assert.equal(iniciado.status, 201);
      const pv = iniciado.body.data.pedido_venta_id as string;
      await vencerReservas(pv);

      const preJob = await llamar(jar, `/tienda/checkout/pendiente?pedido=${pv}`);
      assert.equal(preJob.status, 200);
      assert.match(preJob.html, /Reserva vencida/);
      assert.match(preJob.html, /volvieron a estar[\s\S]{0,20}disponibles/);
      assert.match(preJob.html, /href="\/tienda\/catalogo"/);
      assert.doesNotMatch(preJob.html, /Pagar con Mercado Pago|Medio de pago/);

      const resultado = await mantenimiento.ejecutarMantenimientoProgramado(new Date());
      assert.equal(resultado.reservas.ok, true);
      await listener.esperarAnulacionesPendientes();
      const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pv } });
      assert.equal(ext.estado_ecommerce, "ANULADO");

      const postJob = await llamar(jar, `/tienda/checkout/pendiente?pedido=${pv}`);
      assert.equal(postJob.status, 200);
      assert.match(postJob.html, /Reserva vencida/);
      assert.doesNotMatch(postJob.html, /No encontramos esa compra pendiente/);
      assert.doesNotMatch(postJob.html, /Pagar con Mercado Pago|Medio de pago/);

      const ajeno = await cuentaConSesion();
      const paginaAjena = await llamar(ajeno.jar, `/tienda/checkout/pendiente?pedido=${pv}`);
      assert.match(paginaAjena.html, /No encontramos esa compra pendiente/, "pedido ajeno: no se revela");
    });

    await t.test("H5 — D2/C2: configuración inválida o ausente → carrito 200 con texto genérico, sin número", async () => {
      const { jar } = await cuentaConSesion();
      await agregarArticulo(jar);
      const fila = await prisma.configuracionSistema.findUniqueOrThrow({ where: { clave: "ECOMMERCE_CHECKOUT_TTL_HORAS" } });
      const verificar = async () => {
        const pagina = await llamar(jar, "/tienda/carrito");
        assert.equal(pagina.status, 200);
        assert.match(pagina.html, /Proceder al pago/);
        assert.match(pagina.html, /por un tiempo limitado/);
        assert.doesNotMatch(pagina.html, /durante \d+ minutos/);
        sinFugasDeTtl(pagina.html);
      };
      try {
        await prisma.configuracionSistema.update({ where: { id: fila.id }, data: { valor: "x" } });
        await verificar();
        await prisma.configuracionSistema.update({ where: { id: fila.id }, data: { valor: fila.valor, clave: `${fila.clave}_TEST_AUSENTE` } });
        await verificar();
      } finally {
        await prisma.configuracionSistema.update({ where: { id: fila.id }, data: { clave: fila.clave, valor: fila.valor } });
      }
    });
  },
);
