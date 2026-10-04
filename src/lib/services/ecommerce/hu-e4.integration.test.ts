import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PagoConsultado } from "../../integraciones/mercadopago/tipos.ts";

/**
 * HU-E4 — Cupones de descuento: servicio + integración con el checkout/pago de
 * HU-E2 contra una base REAL descartable (mismo procedimiento que
 * `docs/modulos/modulo E/HU1_MODULO_E.md` §9.1), con la pasarela de Mercado
 * Pago FALSA y `MP_MODO=simulado`: sin red.
 *
 *   HU_E4_INTEGRATION_DATABASE_URL=$TEST_DB npm run test:integration:e4
 *
 * Cada escenario crea SUS artículos, cuentas y cupones. Nunca se borra nada
 * (Regla N.° 1); `audit_logs` solo se lee.
 */

const DATABASE_URL = process.env.HU_E4_INTEGRATION_DATABASE_URL;
const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
const DIA_MS = 86_400_000;

const errorConCodigo = (codigo: string) => (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === codigo;

test("HU-E4 — cupones contra PostgreSQL", { skip: !DATABASE_URL, timeout: 300_000 }, async (t) => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MP_MODO = "simulado";
  process.env.APP_PUBLIC_URL = "http://localhost:3000";

  const [{ prisma }, carrito, checkout, pagoWeb, cupones, mantenimiento, { ServiceError }, fixtures, canalWeb] =
    await Promise.all([
      import("@/lib/db/prisma"),
      import("./carrito.service"),
      import("./checkout.service"),
      import("./pago-web.service"),
      import("./cupon.service"),
      import("./mantenimiento-programado"),
      import("@/lib/errors/service-error"),
      import("./hu-e1.test-fixtures"),
      import("./usuario-canal-web"),
    ]);
  const canalWebId = await canalWeb.obtenerUsuarioCanalWebId();
  const { CrearCuponSchema, EditarCuponSchema } = await import("@/lib/schemas/cupon.schema");
  const adminEcommerce = await prisma.usuario.findFirstOrThrow({
    where: { nombre_usuario: "admin.ecommerce.seed", is_active: true },
    select: { id: true },
  });
  // Los asientos de auditoría son fire-and-forget: se espera a que la cola se
  // vacíe (conteo estable) antes de desconectar Prisma.
  t.after(async () => {
    let anterior = -1;
    for (let intento = 0; intento < 60; intento++) {
      const actual = await prisma.auditLog.count();
      if (actual === anterior) break;
      anterior = actual;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await prisma.$disconnect();
  });

  // ── Pasarela falsa ─────────────────────────────────────────────────────────
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
      status_detail: estado === "approved" ? "accredited" : "cc_rejected_other_reason",
      monto,
      moneda: "ARS",
      external_reference: ref,
      fecha_aprobacion: estado === "approved" ? new Date().toISOString() : null,
    });
    return id;
  }

  // ── Fixtures ───────────────────────────────────────────────────────────────
  async function crearCupon(
    opciones: {
      tipo?: "PORCENTAJE" | "MONTO_FIJO";
      valor?: number;
      global?: number | null;
      porCliente?: number;
      desde?: Date;
      hasta?: Date;
      activo?: boolean;
    } = {},
  ) {
    const codigo = `E4${randomUUID().slice(0, 8).toUpperCase()}`;
    return prisma.cuponDescuento.create({
      data: {
        codigo,
        tipo_beneficio: opciones.tipo ?? "PORCENTAJE",
        valor: opciones.valor ?? 10,
        vigente_desde: opciones.desde ?? new Date(Date.now() - DIA_MS),
        vigente_hasta: opciones.hasta ?? new Date(Date.now() + DIA_MS),
        limite_uso_global: opciones.global ?? null,
        limite_uso_por_cliente: opciones.porCliente ?? 5,
        ...(opciones.activo === false
          ? { is_active: false, deleted_at: new Date(), deleted_by: "test", deletion_reason: "fixture dado de baja" }
          : {}),
      },
    });
  }

  type Cuenta = Awaited<ReturnType<typeof fixtures.crearCuenta>>;
  /** Carga un carrito para la cuenta (una nueva si no se indica). */
  async function cargarCarrito(opciones: { cuenta?: Cuenta; precio?: number; cantidad?: number; stock?: number } = {}) {
    const articulo = await fixtures.crearArticulo(prisma, {
      stockShowroom: opciones.stock ?? 5,
      precio: opciones.precio ?? 10000,
    });
    const cuenta = opciones.cuenta ?? (await fixtures.crearCuenta(prisma));
    await carrito.agregarAlCarrito(
      { cuentaId: cuenta.cuentaId },
      { variante_sku_id: articulo.varianteId, cantidad: opciones.cantidad ?? 1 },
    );
    return { articulo, cuenta };
  }
  async function compra(codigo: string, opciones: Parameters<typeof cargarCarrito>[0] = {}) {
    const { articulo, cuenta } = await cargarCarrito(opciones);
    const iniciado = await checkout.iniciarCheckout(cuenta.sesion, { cupon_codigo: codigo });
    return { articulo, cuenta, iniciado };
  }
  const aplicacionDe = (pedidoVentaId: string) =>
    prisma.cuponAplicacion.findFirstOrThrow({ where: { pedido_venta_id: pedidoVentaId } });
  const stockShowroom = async (varianteId: string) =>
    (
      await prisma.stockDeposito.findUniqueOrThrow({
        where: { variante_sku_id_deposito_id: { variante_sku_id: varianteId, deposito_id: DEPOSITO_SHOWROOM_ID } },
      })
    ).cantidad;

  // ── CA02 — validación en el servidor ───────────────────────────────────────
  await t.test("CA02 (H01) — concurrencia: cupón de límite global 1 y dos checkouts simultáneos", async () => {
    const cupon = await crearCupon({ global: 1 });
    const [a, b] = await Promise.all([cargarCarrito(), cargarCarrito()]);
    const resultados = await Promise.allSettled([
      checkout.iniciarCheckout(a.cuenta.sesion, { cupon_codigo: cupon.codigo }),
      checkout.iniciarCheckout(b.cuenta.sesion, { cupon_codigo: cupon.codigo }),
    ]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1, "solo un checkout aplica el cupón");
    assert.equal(
      resultados.filter((r) => r.status === "rejected" && errorConCodigo("CUPON_LIMITE_ALCANZADO")(r.reason)).length,
      1,
      "el otro recibe CUPON_LIMITE_ALCANZADO",
    );
    assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: cupon.id } }), 1);
  });

  // ── F01 (Verify) — C y P se leen en un único snapshot ─────────────────────
  type Tx = Parameters<typeof cupones.aplicarCuponTx>[0];
  type Operacion = (...args: unknown[]) => Promise<unknown>;
  /**
   * Proxy del TransactionClient: apenas resuelve la primera lectura de
   * `aplicaciones_cupon` que cumple `esLectura`, corre `intercalar` (en OTRA
   * conexión) y recién después deja continuar a las operaciones siguientes.
   */
  function txConIntercalado(tx: Tx, esLectura: (modelo: boolean, args: unknown[]) => boolean, intercalar: () => Promise<void>): Tx {
    let barrera: Promise<void> | null = null;
    const envolver = (operacion: Operacion, modelo: boolean, sobreAplicaciones: (args: unknown[]) => boolean): Operacion =>
      async (...args) => {
        if (barrera) {
          await barrera;
          return operacion(...args);
        }
        if (!sobreAplicaciones(args) || !esLectura(modelo, args)) return operacion(...args);
        let abrir!: () => void;
        barrera = new Promise((resolve) => (abrir = resolve));
        try {
          const resultado = await operacion(...args);
          await intercalar();
          return resultado;
        } finally {
          abrir();
        }
      };
    const sqlDe = (args: unknown[]) => (args[0] as string[]).join("?");
    return new Proxy(tx, {
      get(objetivo, prop) {
        const valor = Reflect.get(objetivo, prop) as unknown;
        if (prop === "$queryRaw") {
          return envolver((...a) => (valor as Operacion).apply(objetivo, a), false, (a) => sqlDe(a).includes("aplicaciones_cupon"));
        }
        if (prop !== "cuponAplicacion" && prop !== "cuponDescuento") return valor;
        const delegado = valor as Record<string, unknown>;
        return new Proxy(delegado, {
          get(_, metodo) {
            const f = Reflect.get(delegado, metodo) as unknown;
            if (typeof f !== "function") return f;
            return envolver((...a) => (f as Operacion).apply(delegado, a), true, () => prop === "cuponAplicacion");
          },
        });
      },
    });
  }
  /**
   * Cupón con una aplicación pendiente vigente (pedido A). Una segunda
   * admisión (sobre el pedido B) corre con el proxy: el pago completo de A
   * se ejecuta entre la primera lectura de capacidad y el resto.
   */
  async function admitirMientrasSePaga(
    cupon: { codigo: string },
    opciones: { mismoCliente: boolean; esLectura: (modelo: boolean, args: unknown[]) => boolean },
  ) {
    const { Prisma } = await import("@prisma/client");
    const a = await compra(cupon.codigo);
    const b = await cargarCarrito();
    const pedidoB = await checkout.iniciarCheckout(b.cuenta.sesion);
    const pid = pagoMp(a.iniciado.pedido_venta_ecommerce_id, "approved", a.iniciado.total);
    let pago: string | undefined;
    const ADMITIDA = new Error("se admitió una segunda aplicación");
    const resultado = await prisma
      .$transaction(
        async (tx) => {
          const intercalado = txConIntercalado(tx, opciones.esLectura, async () => {
            pago = (await pagoWeb.procesarNotificacionPago(pid, pasarela)).resultado;
          });
          await cupones.aplicarCuponTx(intercalado, {
            codigo: cupon.codigo,
            cliente_id: opciones.mismoCliente ? a.cuenta.clienteId : b.cuenta.clienteId,
            pedido_venta_id: pedidoB.pedido_venta_id,
            subtotal: new Prisma.Decimal(pedidoB.total),
            reserva_hasta: new Date(Date.now() + DIA_MS),
          });
          throw ADMITIDA; // revierte: el sobreconsumo no queda persistido
        },
        { timeout: 30_000 },
      )
      .catch((error: unknown) => error);
    assert.equal(pago, "CONFIRMADO", "el pago completó mientras la admisión tenía el lock del cupón");
    assert.ok(errorConCodigo("CUPON_LIMITE_ALCANZADO")(resultado), String(resultado));
    return a;
  }

  await t.test("F01 — límite global 1: un pago que confirma la reserva entre las lecturas de capacidad no admite otra aplicación", async () => {
    const cupon = await crearCupon({ global: 1 });
    await admitirMientrasSePaga(cupon, { mismoCliente: false, esLectura: () => true });
    assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: cupon.id } }), 1);
    assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: cupon.id, confirmada: true } }), 1);
  });

  await t.test("F01 — límite por cliente 1: un pago que confirma la reserva entre las lecturas del cliente no admite otra aplicación", async () => {
    const cupon = await crearCupon({ porCliente: 1 });
    const porCliente = (modelo: boolean, args: unknown[]) =>
      modelo
        ? (args[0] as { where?: { cliente_id?: unknown } } | undefined)?.where?.cliente_id !== undefined
        : JSON.stringify(args).includes("cliente_id"); // incluye los fragmentos Prisma.sql anidados
    const a = await admitirMientrasSePaga(cupon, { mismoCliente: true, esLectura: porCliente });
    assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: cupon.id, cliente_id: a.cuenta.clienteId } }), 1);
  });

  await t.test("CA02 — no iniciado, vencido y dado de baja: 422 con su motivo, sin reservar stock", async () => {
    const casos = [
      { cupon: await crearCupon({ desde: new Date(Date.now() + DIA_MS), hasta: new Date(Date.now() + 2 * DIA_MS) }), codigo: "CUPON_NO_VIGENTE" },
      { cupon: await crearCupon({ desde: new Date(Date.now() - 2 * DIA_MS), hasta: new Date(Date.now() - DIA_MS) }), codigo: "CUPON_VENCIDO" },
      { cupon: await crearCupon({ activo: false }), codigo: "CUPON_INACTIVO" },
    ];
    for (const caso of casos) {
      const { articulo, cuenta } = await cargarCarrito({ stock: 3 });
      await assert.rejects(
        checkout.iniciarCheckout(cuenta.sesion, { cupon_codigo: caso.cupon.codigo.toLowerCase() }),
        errorConCodigo(caso.codigo),
        caso.codigo,
      );
      assert.equal(await stockShowroom(articulo.varianteId), 3, `${caso.codigo}: rollback completo`);
    }
  });

  await t.test("CA02/CA05 — global agotado por confirmados: el pago consume sin pedir capacidad y el siguiente se rechaza", async () => {
    const cupon = await crearCupon({ global: 1 });
    const a = await compra(cupon.codigo);
    const pid = pagoMp(a.iniciado.pedido_venta_ecommerce_id, "approved", a.iniciado.total);
    assert.equal((await pagoWeb.procesarNotificacionPago(pid, pasarela)).resultado, "CONFIRMADO");
    const confirmada = await aplicacionDe(a.iniciado.pedido_venta_id);
    assert.equal(confirmada.confirmada, true);
    assert.equal(confirmada.is_active, true);

    // Pago duplicado: no confirma dos veces.
    assert.equal((await pagoWeb.procesarNotificacionPago(pid, pasarela)).resultado, "SIN_EFECTO");
    assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: cupon.id, confirmada: true } }), 1);

    await assert.rejects(compra(cupon.codigo), errorConCodigo("CUPON_LIMITE_ALCANZADO"));
  });

  await t.test("CA02 — una reserva vencida no ocupa capacidad aunque el mantenimiento no haya corrido", async () => {
    const cupon = await crearCupon({ global: 1 });
    const a = await compra(cupon.codigo);
    await assert.rejects(compra(cupon.codigo), errorConCodigo("CUPON_LIMITE_ALCANZADO"), "la reserva vigente ocupa el lugar");
    const aplicacion = await aplicacionDe(a.iniciado.pedido_venta_id);
    await prisma.cuponAplicacion.update({ where: { id: aplicacion.id }, data: { reserva_hasta: new Date(Date.now() - 1000) } });
    const b = await compra(cupon.codigo);
    assert.equal((await aplicacionDe(b.iniciado.pedido_venta_id)).confirmada, false);
  });

  await t.test("§2.4.c.5 — la aplicación pendiente guarda reserva_hasta = vencimiento de la reserva del pedido", async () => {
    const cupon = await crearCupon();
    const { iniciado } = await compra(cupon.codigo);
    const aplicacion = await aplicacionDe(iniciado.pedido_venta_id);
    assert.equal(aplicacion.reserva_hasta?.toISOString(), iniciado.ttl_expiracion);
  });

  // ── CA03 — un cupón por pedido ─────────────────────────────────────────────
  await t.test("CA03 — el reintento del mismo pedido no cambia su cupón", async () => {
    const primero = await crearCupon({ valor: 10 });
    const segundo = await crearCupon({ valor: 20 });
    const { iniciado, cuenta } = await compra(primero.codigo);
    const otraVez = await checkout.iniciarCheckout(cuenta.sesion, { cupon_codigo: segundo.codigo });
    assert.equal(otraVez.pedido_venta_id, iniciado.pedido_venta_id);
    assert.equal(otraVez.reutilizado, true);
    assert.equal(otraVez.total, iniciado.total);
    const aplicaciones = await prisma.cuponAplicacion.findMany({ where: { pedido_venta_id: iniciado.pedido_venta_id } });
    assert.deepEqual(aplicaciones.map((a) => a.cupon_id), [primero.id]);
  });

  // ── CA04 — cálculo del descuento ───────────────────────────────────────────
  await t.test("CA04 — porcentaje con redondeo half-up y monto fijo sobre el precio congelado", async () => {
    const porcentaje = await crearCupon({ valor: 12.5 });
    const conPorcentaje = await compra(porcentaje.codigo, { precio: 999.99 });
    // 999.99 × 12.5 % = 124.99875 → 125.00 (half-up)
    assert.equal((await aplicacionDe(conPorcentaje.iniciado.pedido_venta_id)).monto_descontado.toFixed(2), "125.00");
    assert.equal(conPorcentaje.iniciado.total, 874.99);

    const fijo = await crearCupon({ tipo: "MONTO_FIJO", valor: 3000 });
    const conFijo = await compra(fijo.codigo, { precio: 5000, cantidad: 2 });
    assert.equal(conFijo.iniciado.total, 7000);
  });

  await t.test("CA04 (K5) — descuento mayor o igual al subtotal → 422 CUPON_NO_APLICABLE y rollback", async () => {
    for (const valor of [10000, 15000]) {
      const cupon = await crearCupon({ tipo: "MONTO_FIJO", valor });
      const { articulo, cuenta } = await cargarCarrito({ precio: 10000, stock: 2 });
      await assert.rejects(
        checkout.iniciarCheckout(cuenta.sesion, { cupon_codigo: cupon.codigo }),
        (e: unknown) => errorConCodigo("CUPON_NO_APLICABLE")(e) && (e as Error).message === "El cupón no puede cubrir el total del pedido",
      );
      assert.equal(await stockShowroom(articulo.varianteId), 2);
      assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: cupon.id } }), 0);
    }
  });

  // ── CA06 — límite por cliente ──────────────────────────────────────────────
  await t.test("CA06 — límite por cliente 1: el segundo pedido del mismo cliente se rechaza; otro cliente no se afecta", async () => {
    const cupon = await crearCupon({ porCliente: 1 });
    const primero = await compra(cupon.codigo);
    await assert.rejects(compra(cupon.codigo, { cuenta: primero.cuenta }), errorConCodigo("CUPON_LIMITE_ALCANZADO"));
    const otro = await compra(cupon.codigo);
    assert.equal((await aplicacionDe(otro.iniciado.pedido_venta_id)).cliente_id, otro.cuenta.clienteId);
  });

  // ── CA05/CA07 — rechazo, vencimiento del pedido y baja automática ──────────
  await t.test("CA05 — pago rechazado: la aplicación se da de baja con el motivo de E2 y libera el lugar", async () => {
    const cupon = await crearCupon({ global: 1 });
    const a = await compra(cupon.codigo);
    const pid = pagoMp(a.iniciado.pedido_venta_ecommerce_id, "rejected", a.iniciado.total);
    assert.equal((await pagoWeb.procesarNotificacionPago(pid, pasarela)).resultado, "RECHAZADO");
    const aplicacion = await aplicacionDe(a.iniciado.pedido_venta_id);
    assert.equal(aplicacion.is_active, false);
    assert.equal(aplicacion.deletion_reason, "Pago rechazado por Mercado Pago");
    await compra(cupon.codigo); // el lugar quedó libre
  });

  await t.test("CA07 — mantenimiento: libera pendientes vencidas (TTL_CHECKOUT_VENCIDO) y es idempotente", async () => {
    const cupon = await crearCupon({ global: 3 });
    const vencida = await compra(cupon.codigo);
    const vigente = await compra(cupon.codigo);
    const aplicacionVencida = await aplicacionDe(vencida.iniciado.pedido_venta_id);
    await prisma.cuponAplicacion.update({
      where: { id: aplicacionVencida.id },
      data: { reserva_hasta: new Date(Date.now() - 1000) },
    });

    const primera = await cupones.ejecutarMantenimientoCupones();
    assert.ok(primera.aplicaciones_liberadas.includes(aplicacionVencida.id));
    const liberada = await aplicacionDe(vencida.iniciado.pedido_venta_id);
    assert.equal(liberada.is_active, false);
    assert.ok(liberada.deleted_at);
    assert.equal(liberada.deleted_by, canalWebId);
    assert.equal(liberada.deletion_reason, "TTL_CHECKOUT_VENCIDO");
    assert.equal((await aplicacionDe(vigente.iniciado.pedido_venta_id)).is_active, true, "la vigente no se toca");

    const segunda = await cupones.ejecutarMantenimientoCupones();
    assert.ok(!segunda.aplicaciones_liberadas.includes(aplicacionVencida.id));
    assert.equal((await aplicacionDe(vencida.iniciado.pedido_venta_id)).deleted_at?.getTime(), liberada.deleted_at.getTime());
  });

  await t.test("CA07 — mantenimiento: una aplicación CONFIRMADA con reserva_hasta vencida no se libera ni se da de baja", async () => {
    const cupon = await crearCupon({ global: 3 });
    const pagada = await compra(cupon.codigo);
    await pagoWeb.procesarNotificacionPago(
      pagoMp(pagada.iniciado.pedido_venta_ecommerce_id, "approved", pagada.iniciado.total),
      pasarela,
    );
    const confirmada = await aplicacionDe(pagada.iniciado.pedido_venta_id);
    assert.equal(confirmada.confirmada, true);
    await prisma.cuponAplicacion.update({ where: { id: confirmada.id }, data: { reserva_hasta: new Date(Date.now() - 1000) } });

    const resultado = await cupones.ejecutarMantenimientoCupones();
    assert.ok(!resultado.aplicaciones_liberadas.includes(confirmada.id));
    const despues = await aplicacionDe(pagada.iniciado.pedido_venta_id);
    assert.equal(despues.confirmada, true);
    assert.equal(despues.is_active, true);
    assert.equal(despues.deleted_at, null);
    assert.equal(despues.deleted_by, null);
    assert.equal(despues.deletion_reason, null);
  });

  await t.test("CA07 — mantenimiento: da de baja vencidos y agotados; una reserva activa no agota; no duplica bajas", async () => {
    const vencido = await crearCupon({ desde: new Date(Date.now() - 3 * DIA_MS), hasta: new Date(Date.now() - DIA_MS) });

    const agotado = await crearCupon({ global: 1 });
    const consumo = await compra(agotado.codigo);
    await pagoWeb.procesarNotificacionPago(
      pagoMp(consumo.iniciado.pedido_venta_ecommerce_id, "approved", consumo.iniciado.total),
      pasarela,
    );

    const reservado = await crearCupon({ global: 1 });
    await compra(reservado.codigo); // P = 1, C = 0: ocupado, no agotado

    // Vencido Y agotado: gana el vencimiento.
    const ambos = await crearCupon({ global: 1 });
    const consumoAmbos = await compra(ambos.codigo);
    await pagoWeb.procesarNotificacionPago(
      pagoMp(consumoAmbos.iniciado.pedido_venta_ecommerce_id, "approved", consumoAmbos.iniciado.total),
      pasarela,
    );
    await prisma.cuponDescuento.update({ where: { id: ambos.id }, data: { vigente_hasta: new Date(Date.now() - 1000) } });

    const primera = await cupones.ejecutarMantenimientoCupones();
    const motivoDe = (id: string) => primera.cupones_dados_de_baja.find((b) => b.cupon_id === id)?.motivo;
    assert.equal(motivoDe(vencido.id), "VENCIMIENTO");
    assert.equal(motivoDe(agotado.id), "LIMITE_GLOBAL_AGOTADO");
    assert.equal(motivoDe(ambos.id), "VENCIMIENTO");
    assert.equal(motivoDe(reservado.id), undefined);

    const bajaAgotado = await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: agotado.id } });
    assert.equal(bajaAgotado.is_active, false);
    assert.ok(bajaAgotado.deleted_at);
    assert.equal(bajaAgotado.deleted_by, canalWebId);
    assert.equal(bajaAgotado.deletion_reason, "LIMITE_GLOBAL_AGOTADO");
    assert.equal((await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: reservado.id } })).is_active, true);
    assert.equal(await prisma.cuponAplicacion.count({ where: { cupon_id: agotado.id, confirmada: true, is_active: true } }), 1, "el historial se conserva");

    const segunda = await cupones.ejecutarMantenimientoCupones();
    for (const id of [vencido.id, agotado.id, ambos.id]) {
      assert.ok(!segunda.cupones_dados_de_baja.some((b) => b.cupon_id === id), "no se repite la baja");
    }
    const otraVez = await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: agotado.id } });
    assert.equal(otraVez.deleted_at?.getTime(), bajaAgotado.deleted_at.getTime());
  });

  await t.test("CA07 — el cron y el script corren el mantenimiento de cupones aunque falle el job de Módulo A", async () => {
    const cupon = await crearCupon({ desde: new Date(Date.now() - 3 * DIA_MS), hasta: new Date(Date.now() - DIA_MS) });
    const errores: unknown[] = [];
    const errorOriginal = console.error;
    console.error = (...args: unknown[]) => void errores.push(args);
    try {
      const resultado = await mantenimiento.ejecutarMantenimientoProgramado(new Date(), {
        liberarReservasVencidas: async () => {
          throw new Error("falla simulada de Módulo A");
        },
        ejecutarMantenimientoCupones: cupones.ejecutarMantenimientoCupones,
      });
      assert.equal(resultado.reservas.ok, false);
      assert.equal(resultado.cupones.ok, true);
      assert.ok(resultado.cupones.ok && resultado.cupones.valor.cupones_dados_de_baja.some((b) => b.cupon_id === cupon.id));
      assert.equal(errores.length, 1, "el error de Módulo A se loguea");

      // Y al revés: si fallan los cupones, Módulo A corre igual.
      let reservasCorrieron = false;
      const inverso = await mantenimiento.ejecutarMantenimientoProgramado(new Date(), {
        liberarReservasVencidas: async (ahora) => {
          reservasCorrieron = true;
          return { umbral: ahora.toISOString(), total_liberadas: 0, liberadas: [] };
        },
        ejecutarMantenimientoCupones: async () => {
          throw new Error("falla simulada de cupones");
        },
      });
      assert.equal(inverso.reservas.ok, true);
      assert.equal(inverso.cupones.ok, false);
      assert.equal(reservasCorrieron, true);
    } finally {
      console.error = errorOriginal;
    }
    const fuenteCron = readFileSync("src/app/api/cron/check-pruebas-vencidas/route.ts", "utf8");
    const fuenteScript = readFileSync("scripts/liberar-reservas-vencidas.ts", "utf8");
    assert.match(fuenteCron, /ejecutarMantenimientoProgramado\(/);
    assert.match(fuenteScript, /ejecutarMantenimientoProgramado\(/);
  });

  // ── Administración (§2.4.e) ────────────────────────────────────────────────
  const isoEnDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString();
  const altaValida = (extra: Record<string, unknown> = {}) =>
    CrearCuponSchema.parse({
      codigo: `e4adm${randomUUID().slice(0, 8)}`,
      tipo_beneficio: "PORCENTAJE",
      valor: "15",
      vigente_desde: isoEnDias(-1),
      vigente_hasta: isoEnDias(10),
      ...extra,
    });
  const editar = (id: string, body: Record<string, unknown>) =>
    cupones.editarCupon(id, EditarCuponSchema.parse(body), adminEcommerce.id);

  await t.test("CA01 — crear válido: código normalizado, DTO con estado derivado y capacidad", async () => {
    const input = altaValida({ limite_uso_global: 10, limite_uso_por_cliente: 2 });
    const cupon = await cupones.crearCupon(input, adminEcommerce.id);
    assert.equal(cupon.codigo, input.codigo);
    assert.match(cupon.codigo, /^E4ADM[0-9A-F]{8}$/);
    assert.equal(cupon.tipo_beneficio, "PORCENTAJE");
    assert.equal(cupon.valor, "15.00");
    assert.equal(cupon.estado, "VIGENTE");
    assert.equal(cupon.limite_uso_global, 10);
    assert.equal(cupon.limite_uso_por_cliente, 2);
    assert.equal(cupon.usos_confirmados, 0);
    assert.equal(cupon.reservas_vigentes, 0);
    assert.equal(cupon.capacidad_disponible, 10);
    assert.equal(cupon.tiene_aplicaciones, false);
    assert.equal(cupon.is_active, true);
    assert.equal(cupon.deleted_at, null);
    const ilimitado = await cupones.crearCupon(altaValida(), adminEcommerce.id);
    assert.equal(ilimitado.limite_uso_global, null);
    assert.equal(ilimitado.capacidad_disponible, null);
  });

  await t.test("CA01 — código duplicado (también contra uno dado de baja) → 409 CUPON_CODIGO_EXISTENTE", async () => {
    const input = altaValida();
    const cupon = await cupones.crearCupon(input, adminEcommerce.id);
    await assert.rejects(cupones.crearCupon(input, adminEcommerce.id), errorConCodigo("CUPON_CODIGO_EXISTENTE"));
    await cupones.darDeBajaCupon(cupon.id, "Campaña cancelada", adminEcommerce.id);
    await assert.rejects(cupones.crearCupon(input, adminEcommerce.id), errorConCodigo("CUPON_CODIGO_EXISTENTE"));
  });

  await t.test("§2.4.b — estados derivados, reservas vigentes y capacidad disponible en el DTO", async () => {
    const noIniciado = await crearCupon({ desde: new Date(Date.now() + DIA_MS), hasta: new Date(Date.now() + 2 * DIA_MS) });
    const vencido = await crearCupon({ desde: new Date(Date.now() - 2 * DIA_MS), hasta: new Date(Date.now() - DIA_MS) });
    const baja = await crearCupon({ activo: false });
    const reservado = await crearCupon({ global: 3 });
    await compra(reservado.codigo);
    const agotado = await crearCupon({ global: 1 });
    const consumo = await compra(agotado.codigo);
    await pagoWeb.procesarNotificacionPago(
      pagoMp(consumo.iniciado.pedido_venta_ecommerce_id, "approved", consumo.iniciado.total),
      pasarela,
    );
    const estadoDe = async (id: string) => (await cupones.obtenerCupon(id)).estado;
    assert.equal(await estadoDe(noIniciado.id), "NO_INICIADO");
    assert.equal(await estadoDe(vencido.id), "VENCIDO");
    assert.equal(await estadoDe(baja.id), "DADO_DE_BAJA");
    assert.equal(await estadoDe(agotado.id), "AGOTADO");
    const conReserva = await cupones.obtenerCupon(reservado.id);
    assert.equal(conReserva.estado, "VIGENTE", "las reservas no agotan");
    assert.equal(conReserva.reservas_vigentes, 1);
    assert.equal(conReserva.usos_confirmados, 0);
    assert.equal(conReserva.capacidad_disponible, 2);
    assert.equal(conReserva.tiene_aplicaciones, true);
    await assert.rejects(cupones.obtenerCupon(randomUUID()), errorConCodigo("CUPON_NO_ENCONTRADO"));
  });

  await t.test("§2.4.e — listar: ACTIVOS por defecto, INACTIVOS, TODOS, búsqueda por código y orden por alta", async () => {
    const prefijo = `E4LST${randomUUID().slice(0, 6).toUpperCase()}`;
    const primero = await cupones.crearCupon(altaValida({ codigo: `${prefijo}-A` }), adminEcommerce.id);
    const segundo = await cupones.crearCupon(altaValida({ codigo: `${prefijo}-B` }), adminEcommerce.id);
    await cupones.darDeBajaCupon(primero.id, "Prueba de filtro", adminEcommerce.id);
    const codigos = async (estado: "ACTIVOS" | "INACTIVOS" | "TODOS") =>
      (await cupones.listarCupones({ estado, q: prefijo })).map((c) => c.codigo);
    assert.deepEqual(await codigos("ACTIVOS"), [segundo.codigo]);
    assert.deepEqual(await codigos("INACTIVOS"), [primero.codigo]);
    assert.deepEqual(await codigos("TODOS"), [segundo.codigo, primero.codigo]);
  });

  await t.test("CA08 — baja manual con los cuatro campos; repetida sin cambios; editar uno dado de baja → 409", async () => {
    const cupon = await cupones.crearCupon(altaValida(), adminEcommerce.id);
    const baja = await cupones.darDeBajaCupon(cupon.id, "Fin de la campaña", adminEcommerce.id);
    assert.equal(baja.is_active, false);
    assert.equal(baja.estado, "DADO_DE_BAJA");
    assert.equal(baja.deletion_reason, "Fin de la campaña");
    const fila = await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: cupon.id } });
    assert.equal(fila.is_active, false);
    assert.ok(fila.deleted_at);
    assert.equal(fila.deleted_by, adminEcommerce.id);
    assert.equal(fila.deletion_reason, "Fin de la campaña");

    const repetida = await cupones.darDeBajaCupon(cupon.id, "Otro motivo", adminEcommerce.id);
    assert.equal(repetida.deletion_reason, "Fin de la campaña");
    const igual = await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: cupon.id } });
    assert.equal(igual.deleted_at?.getTime(), fila.deleted_at.getTime());
    assert.equal(igual.updated_at.getTime(), fila.updated_at.getTime());

    await assert.rejects(editar(cupon.id, { limite_uso_por_cliente: 3 }), errorConCodigo("CUPON_INACTIVO"));
    await assert.rejects(cupones.darDeBajaCupon(randomUUID(), "No existe", adminEcommerce.id), errorConCodigo("CUPON_NO_ENCONTRADO"));
    await assert.rejects(editar(randomUUID(), { limite_uso_por_cliente: 3 }), errorConCodigo("CUPON_NO_ENCONTRADO"));
  });

  await t.test("K4 — sin aplicaciones: edición libre; un PATCH sin cambios no toca la fila", async () => {
    const cupon = await cupones.crearCupon(altaValida({ limite_uso_global: 5 }), adminEcommerce.id);
    const editado = await editar(cupon.id, {
      tipo_beneficio: "MONTO_FIJO",
      valor: "2500.50",
      vigente_desde: isoEnDias(-2),
      vigente_hasta: isoEnDias(20),
      limite_uso_global: 2,
      limite_uso_por_cliente: 1,
    });
    assert.equal(editado.tipo_beneficio, "MONTO_FIJO");
    assert.equal(editado.valor, "2500.50");
    assert.equal(editado.limite_uso_global, 2);

    const antes = await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: cupon.id } });
    const sinCambios = await editar(cupon.id, { valor: "2500.5", limite_uso_global: 2 });
    assert.equal(sinCambios.valor, "2500.50");
    assert.equal(
      (await prisma.cuponDescuento.findUniqueOrThrow({ where: { id: cupon.id } })).updated_at.getTime(),
      antes.updated_at.getTime(),
    );
  });

  await t.test("K4 — validaciones cruzadas contra los valores guardados → VALIDATION_ERROR", async () => {
    const cupon = await cupones.crearCupon(altaValida(), adminEcommerce.id);
    await assert.rejects(editar(cupon.id, { valor: "100" }), errorConCodigo("VALIDATION_ERROR"), "porcentaje guardado");
    await assert.rejects(editar(cupon.id, { vigente_hasta: isoEnDias(-5) }), errorConCodigo("VALIDATION_ERROR"), "ventana");
  });

  await t.test("K4 — con una aplicación (aunque liberada): ampliar límites sí; reducir o cambiar valor/fechas → 409", async () => {
    const creado = await cupones.crearCupon(altaValida({ limite_uso_global: 2, limite_uso_por_cliente: 1 }), adminEcommerce.id);
    const a = await compra(creado.codigo);
    await pagoWeb.procesarNotificacionPago(pagoMp(a.iniciado.pedido_venta_ecommerce_id, "rejected", a.iniciado.total), pasarela);
    assert.equal((await aplicacionDe(a.iniciado.pedido_venta_id)).is_active, false, "aplicación liberada");
    assert.equal((await cupones.obtenerCupon(creado.id)).tiene_aplicaciones, true);

    for (const body of [
      { limite_uso_global: 1 },
      { limite_uso_por_cliente: 2, valor: "20" },
      { valor: "20" },
      { tipo_beneficio: "MONTO_FIJO" },
      { vigente_hasta: isoEnDias(30) },
      { vigente_desde: isoEnDias(-3) },
    ]) {
      await assert.rejects(editar(creado.id, body), errorConCodigo("CUPON_EDICION_RESTRINGIDA"), JSON.stringify(body));
    }
    assert.equal((await editar(creado.id, { limite_uso_global: 5 })).limite_uso_global, 5);
    assert.equal((await editar(creado.id, { limite_uso_por_cliente: 3 })).limite_uso_por_cliente, 3);
    assert.equal((await editar(creado.id, { limite_uso_global: null })).limite_uso_global, null);
    await assert.rejects(editar(creado.id, { limite_uso_global: 100 }), errorConCodigo("CUPON_EDICION_RESTRINGIDA"), "de ilimitado a finito reduce");
    await assert.rejects(editar(creado.id, { limite_uso_por_cliente: 2 }), errorConCodigo("CUPON_EDICION_RESTRINGIDA"));
  });

  // ── CA09 — eventos y auditoría ─────────────────────────────────────────────
  await t.test("CA09 — cada transición emite su evento post-COMMIT y deja una fila en audit_logs", async () => {
    const { domainEventBus } = await import("@/lib/events/domain-event-bus");
    const nombres = [
      "ecommerce:cupon_creado",
      "ecommerce:cupon_editado",
      "ecommerce:cupon_baja",
      "ecommerce:cupon_aplicado",
      "ecommerce:cupon_consumido",
      "ecommerce:cupon_aplicacion_liberada",
    ] as const;
    const eventos: { nombre: string; payload: Record<string, unknown> }[] = [];
    for (const nombre of nombres) {
      domainEventBus.on(nombre, (payload) => eventos.push({ nombre, payload: payload as unknown as Record<string, unknown> }));
    }
    const de = (nombre: string, cuponId: string) => eventos.filter((e) => e.nombre === nombre && e.payload.cupon_id === cuponId);

    // Alta, edición (con y sin cambios), aplicación, consumo.
    const cupon = await cupones.crearCupon(altaValida({ limite_uso_global: 2 }), adminEcommerce.id);
    await editar(cupon.id, { limite_uso_por_cliente: 2 });
    await editar(cupon.id, { limite_uso_por_cliente: 2 }); // sin cambios: sin evento
    const pagada = await compra(cupon.codigo);
    const aplicacionPagada = await aplicacionDe(pagada.iniciado.pedido_venta_id);
    await pagoWeb.procesarNotificacionPago(
      pagoMp(pagada.iniciado.pedido_venta_ecommerce_id, "approved", pagada.iniciado.total),
      pasarela,
    );
    // Rechazo y vencimiento.
    const rechazada = await compra(cupon.codigo);
    const aplicacionRechazada = await aplicacionDe(rechazada.iniciado.pedido_venta_id);
    await pagoWeb.procesarNotificacionPago(
      pagoMp(rechazada.iniciado.pedido_venta_ecommerce_id, "rejected", rechazada.iniciado.total),
      pasarela,
    );
    const vencida = await compra(cupon.codigo);
    const aplicacionVencida = await aplicacionDe(vencida.iniciado.pedido_venta_id);
    await prisma.cuponAplicacion.update({ where: { id: aplicacionVencida.id }, data: { reserva_hasta: new Date(Date.now() - 1000) } });
    await cupones.ejecutarMantenimientoCupones();
    // Baja manual, repetida sin evento.
    await cupones.darDeBajaCupon(cupon.id, "Cierre de campaña", adminEcommerce.id);
    await cupones.darDeBajaCupon(cupon.id, "Cierre de campaña", adminEcommerce.id);
    // Baja automática (vencido).
    const vencido = await crearCupon({ desde: new Date(Date.now() - 3 * DIA_MS), hasta: new Date(Date.now() - DIA_MS) });
    await cupones.ejecutarMantenimientoCupones();
    await cupones.ejecutarMantenimientoCupones(); // idempotente: sin otro evento

    const base = (payload: Record<string, unknown>, actorTipo: string, actorId: string) => {
      assert.equal(payload.actor_tipo, actorTipo);
      assert.equal(payload.actor_id, actorId);
      assert.ok(!Number.isNaN(Date.parse(payload.ocurrido_en as string)));
    };

    const [creado] = de("ecommerce:cupon_creado", cupon.id);
    base(creado.payload, "usuario", adminEcommerce.id);
    assert.equal(creado.payload.codigo, cupon.codigo);
    assert.equal(creado.payload.valor, "15.00");
    assert.equal(creado.payload.limite_uso_global, 2);

    const editados = de("ecommerce:cupon_editado", cupon.id);
    assert.equal(editados.length, 1, "un PATCH sin cambios no emite");
    base(editados[0].payload, "usuario", adminEcommerce.id);
    assert.deepEqual(editados[0].payload.antes, { limite_uso_por_cliente: 1 });
    assert.deepEqual(editados[0].payload.despues, { limite_uso_por_cliente: 2 });

    const aplicados = de("ecommerce:cupon_aplicado", cupon.id);
    assert.equal(aplicados.length, 3);
    const aplicado = aplicados.find((e) => e.payload.aplicacion_id === aplicacionPagada.id)!;
    base(aplicado.payload, "cuenta", pagada.cuenta.cuentaId);
    assert.equal(aplicado.payload.pedido_venta_id, pagada.iniciado.pedido_venta_id);
    assert.equal(aplicado.payload.cliente_id, pagada.cuenta.clienteId);
    assert.equal(aplicado.payload.monto_descontado, "1500.00");
    assert.equal(aplicado.payload.reserva_hasta, pagada.iniciado.ttl_expiracion);

    const consumidos = de("ecommerce:cupon_consumido", cupon.id);
    assert.equal(consumidos.length, 1);
    base(consumidos[0].payload, "sistema", canalWebId);
    assert.equal(consumidos[0].payload.aplicacion_id, aplicacionPagada.id);

    const liberadas = de("ecommerce:cupon_aplicacion_liberada", cupon.id);
    assert.deepEqual(
      liberadas.map((e) => [e.payload.aplicacion_id, e.payload.motivo]).sort(),
      [
        [aplicacionRechazada.id, "Pago rechazado por Mercado Pago"],
        [aplicacionVencida.id, "TTL_CHECKOUT_VENCIDO"],
      ].sort(),
    );
    for (const liberada of liberadas) base(liberada.payload, "sistema", canalWebId);

    const bajasManual = de("ecommerce:cupon_baja", cupon.id);
    assert.equal(bajasManual.length, 1, "la baja repetida no emite");
    base(bajasManual[0].payload, "usuario", adminEcommerce.id);
    assert.equal(bajasManual[0].payload.motivo, "Cierre de campaña");
    const bajasAuto = de("ecommerce:cupon_baja", vencido.id);
    assert.equal(bajasAuto.length, 1, "el mantenimiento repetido no emite");
    base(bajasAuto[0].payload, "sistema", canalWebId);
    assert.equal(bajasAuto[0].payload.motivo, "VENCIMIENTO");

    for (const evento of eventos) {
      assert.doesNotMatch(JSON.stringify(evento.payload), /"dni"|"email"|"telefono"/, evento.nombre);
    }

    // Una fila de audit_logs por evento (el listener es fire-and-forget).
    const registros = [
      { accion: "ecommerce:cupon_creado", registro_id: cupon.id, n: 1 },
      { accion: "ecommerce:cupon_editado", registro_id: cupon.id, n: 1 },
      { accion: "ecommerce:cupon_baja", registro_id: cupon.id, n: 1 },
      { accion: "ecommerce:cupon_baja", registro_id: vencido.id, n: 1 },
      { accion: "ecommerce:cupon_aplicado", registro_id: aplicacionPagada.id, n: 1 },
      { accion: "ecommerce:cupon_consumido", registro_id: aplicacionPagada.id, n: 1 },
      { accion: "ecommerce:cupon_aplicacion_liberada", registro_id: aplicacionRechazada.id, n: 1 },
      { accion: "ecommerce:cupon_aplicacion_liberada", registro_id: aplicacionVencida.id, n: 1 },
    ];
    for (let intento = 0; intento < 40; intento++) {
      const conteos = await Promise.all(registros.map((r) => prisma.auditLog.count({ where: { accion: r.accion, registro_id: r.registro_id } })));
      if (conteos.every((c, i) => c >= registros[i].n)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const r of registros) {
      assert.equal(await prisma.auditLog.count({ where: { accion: r.accion, registro_id: r.registro_id } }), r.n, `${r.accion} ${r.registro_id}`);
    }
    const asientoAplicado = await prisma.auditLog.findFirstOrThrow({
      where: { accion: "ecommerce:cupon_aplicado", registro_id: aplicacionPagada.id },
    });
    assert.equal(asientoAplicado.tabla_afectada, "aplicaciones_cupon");
    assert.equal(asientoAplicado.usuario_id, null, "actor cuenta: sin Usuario del ERP");
    const asientoBaja = await prisma.auditLog.findFirstOrThrow({ where: { accion: "ecommerce:cupon_baja", registro_id: cupon.id } });
    assert.equal(asientoBaja.tabla_afectada, "cupones_descuento");
    assert.equal(asientoBaja.usuario_id, adminEcommerce.id);
  });

  await t.test("CA09 — la cadena SHA-256 del ledger sigue íntegra", async () => {
    const { verificarCadenaIntegridad } = await import("@/lib/services/auditoria/audit-log.service");
    // Se espera a que la cola del ledger se vacíe antes de verificar.
    let anterior = -1;
    for (let intento = 0; intento < 60; intento++) {
      const actual = await prisma.auditLog.count();
      if (actual === anterior) break;
      anterior = actual;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const resultado = await verificarCadenaIntegridad();
    assert.equal(resultado.integra, true, JSON.stringify(resultado));
  });
});
