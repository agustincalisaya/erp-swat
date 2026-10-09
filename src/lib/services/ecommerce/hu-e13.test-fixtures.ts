/**
 * HU-E13 T17 — fixtures compartidos por la integración PostgreSQL end-to-end
 * (`hu-e13.integration.test.ts` y `hu-e13.e2e.http.integration.test.ts`).
 *
 * Los pedidos se construyen por el circuito productivo real: carrito →
 * checkout → pago E2 → toma E12 → scans → completar. Las únicas excepciones
 * son precondiciones imposibles de producir con el código vigente y quedan
 * nombradas como tales: pedido pagado legacy (anterior a `TransaccionPagoLog`),
 * evidencia de pago contradictoria y el avance del reloj sobre un plazo ya
 * persistido. Nunca se borra nada (Regla N.° 1): base de test descartable.
 *
 * Importar dinámicamente DESPUÉS de fijar `process.env.DATABASE_URL`.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.ts";
import * as fixturesE1 from "./hu-e1.test-fixtures.ts";
import { agregarAlCarrito } from "./carrito.service.ts";
import { iniciarCheckout } from "./checkout.service.ts";
import { procesarNotificacionPago } from "./pago-web.service.ts";
import { completarPreparacion, confirmarItem, tomarPedido } from "./pick-pack.service.ts";

export const { DEPOSITO_CENTRAL_ID, DEPOSITO_SHOWROOM_ID } = fixturesE1;

/** Valida que la URL apunte a una base PostgreSQL local identificada como test. */
export function exigirDbDeTest(url: string): string {
  const parsed = new URL(url);
  const nombre = parsed.pathname.replace(/^\//, "");
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !/^swat_erp_test_e13_[a-z0-9_]+$/.test(nombre)) {
    throw new Error(`HU-E13 T17 exige una base local swat_erp_test_e13_*; se recibió "${nombre}"`);
  }
  return url;
}

export const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function esperarHasta(condicion: () => Promise<boolean>, descripcion: string, ms = 10_000): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await dormir(25);
  }
  assert.fail(`Timeout esperando: ${descripcion}`);
}

/**
 * Espera a que los listeners post-commit (AuditLog/F3) terminen: el ledger y
 * las notificaciones deben quedar sin cambios durante una ventana estable.
 * Indispensable antes de cruzar de proceso (test ↔ servidor Next), porque la
 * serialización del ledger SHA-256 es en memoria por proceso.
 */
export async function drenarListeners(estableMs = 400): Promise<void> {
  let anterior = "";
  let desde = Date.now();
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    const [audit, notificaciones] = await Promise.all([prisma.auditLog.count(), prisma.notificacion.count()]);
    const actual = `${audit}:${notificaciones}`;
    if (actual !== anterior) {
      anterior = actual;
      desde = Date.now();
    } else if (Date.now() - desde >= estableMs) {
      return;
    }
    await dormir(50);
  }
  assert.fail("Los listeners post-commit no se estabilizaron");
}

// ──────────────────────────────────────────────────────────────────────────────
// Mercado Pago simulado en la frontera HTTP (adapter F1 real, MP_MODO=real)
// ──────────────────────────────────────────────────────────────────────────────

export type GuionRefund =
  | "approved"
  | "pending"
  | "rejected"
  | "timeout"
  | "red"
  | "http_400"
  | "http_404"
  | "http_429"
  | "http_500"
  | "ambigua";

export interface LlamadaRefundMp {
  payment_id: string;
  url: string;
  method: string;
  body: BodyInit | null | undefined;
  idempotency_key: string | null;
  authorization_presente: boolean;
  guion: GuionRefund;
}

/**
 * Simulador determinista de Mercado Pago que respeta `X-Idempotency-Key`:
 * - misma clave → mismo `refund_id` (un `pending` puede progresar a `approved`);
 * - una clave nueva sobre un pago ya reembolsado → `400` (MP no reembolsa dos
 *   veces un pago total), así no es más permisivo que F1;
 * - fallas técnicas no registran nada remoto.
 * Las respuestas se guionan por `payment_id`; sin guion, aprueba.
 */
export class MercadoPagoFake {
  readonly llamadas: LlamadaRefundMp[] = [];
  private readonly guiones = new Map<string, GuionRefund[]>();
  private readonly montos = new Map<string, number>();
  private readonly porClave = new Map<string, { id: string; payment_id: string; status: string }>();
  private readonly aprobadoPorPago = new Map<string, string>();
  private fetchOriginal: typeof fetch | null = null;

  registrarPago(paymentId: string, monto: number): void {
    this.montos.set(paymentId, monto);
  }

  guionar(paymentId: string, ...guion: GuionRefund[]): void {
    this.guiones.set(paymentId, [...(this.guiones.get(paymentId) ?? []), ...guion]);
  }

  llamadasDe(paymentId: string): LlamadaRefundMp[] {
    return this.llamadas.filter((llamada) => llamada.payment_id === paymentId);
  }

  instalar(): void {
    this.fetchOriginal = globalThis.fetch;
    const original = this.fetchOriginal;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://api.mercadopago.com")) return original(input, init);
      return this.responder(url, init ?? {});
    }) as typeof fetch;
  }

  desinstalar(): void {
    if (this.fetchOriginal) globalThis.fetch = this.fetchOriginal;
    this.fetchOriginal = null;
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  private responder(url: string, init: RequestInit): Response {
    const headers = new Headers(init.headers);
    const ruta = url.slice("https://api.mercadopago.com".length);
    if (ruta === "/v1/payment_methods" && init.method === "GET") return this.json(200, []);
    if (ruta === "/checkout/preferences" && init.method === "POST") {
      const id = `T17-PREF-${randomUUID()}`;
      return this.json(201, { id, init_point: `https://mp.test/checkout/${id}` });
    }
    const refund = /^\/v1\/payments\/([^/]+)\/refunds$/.exec(ruta);
    if (!refund || init.method !== "POST") throw new Error(`Llamada MP inesperada en T17: ${init.method} ${ruta}`);
    const paymentId = decodeURIComponent(refund[1]!);
    const clave = headers.get("X-Idempotency-Key");
    const cola = this.guiones.get(paymentId) ?? [];
    const guion = cola.shift() ?? "approved";
    this.llamadas.push({
      payment_id: paymentId,
      url,
      method: init.method,
      body: init.body,
      idempotency_key: clave,
      authorization_presente: (headers.get("Authorization") ?? "").startsWith("Bearer ") &&
        (headers.get("Authorization") ?? "").length > "Bearer ".length,
      guion,
    });
    if (guion === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (guion === "red") throw new TypeError("fetch failed");
    if (guion === "http_400") return this.json(400, { message: "bad_request" });
    if (guion === "http_404") return this.json(404, { message: "not_found" });
    if (guion === "http_429") return this.json(429, { message: "too_many_requests" });
    if (guion === "http_500") return this.json(500, { message: "internal_error" });
    if (guion === "ambigua") return new Response("<html>gateway</html>", { status: 200 });
    if (!clave) return this.json(400, { message: "X-Idempotency-Key requerido" });
    const monto = this.montos.get(paymentId);
    if (monto === undefined) return this.json(404, { message: "payment_not_found" });
    const aprobadoPrevio = this.aprobadoPorPago.get(paymentId);
    if (aprobadoPrevio && aprobadoPrevio !== clave) return this.json(400, { message: "payment_already_refunded" });
    const previo = this.porClave.get(clave);
    if (previo && previo.status !== "pending") return this.json(201, { ...previo, amount: monto });
    const status = guion === "approved" ? "approved" : guion === "pending" ? "pending" : "rejected";
    const id = previo?.id ?? `T17-REF-${createHash("sha256").update(`${paymentId}:${clave}`).digest("hex").slice(0, 20)}`;
    const registro = { id, payment_id: paymentId, status };
    this.porClave.set(clave, registro);
    if (status === "approved") this.aprobadoPorPago.set(paymentId, clave);
    return this.json(201, { ...registro, amount: monto });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Circuito productivo
// ──────────────────────────────────────────────────────────────────────────────

export type CuentaFixture = fixturesE1.CuentaFixture;

export async function crearCuenta(passwordHash?: string): Promise<CuentaFixture> {
  return fixturesE1.crearCuenta(prisma, { passwordHash });
}

export interface LineaCompra {
  cantidad: number;
  precio?: number;
}

export interface CompraPagada {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  total: number;
  payment_id: string;
  cuenta: CuentaFixture;
  dni: string;
  deposito_id: string;
  articulos: { variante_sku_id: string; sku: string; cantidad: number }[];
  stock_inicial: Map<string, number>;
}

async function depositoCanalWeb(): Promise<string> {
  const config = await prisma.configuracionSistema.findUniqueOrThrow({
    where: { clave: "ECOMMERCE_DEPOSITO_CANAL_WEB_ID" },
    select: { valor: true },
  });
  return config.valor;
}

/** Notificación de pago aprobado E2 (consulta de MP inyectada como en las suites E2 vigentes). */
export function notificarPagoAprobado(compra: Pick<CompraPagada, "payment_id" | "pedido_venta_ecommerce_id" | "total">) {
  return procesarNotificacionPago(compra.payment_id, {
    consultarPago: async () => ({
      payment_id: compra.payment_id,
      estado: "APROBADO",
      status_mp: "approved",
      status_detail: "accredited",
      monto: compra.total,
      moneda: "ARS",
      external_reference: compra.pedido_venta_ecommerce_id,
      fecha_aprobacion: new Date().toISOString(),
    }),
    cerrarCobro: async () => undefined,
  });
}

/**
 * Carrito → checkout (reserva A, B RESERVADO, E PAGO_PENDIENTE) → pago E2
 * aprobado por la notificación de MP. La pasarela de consulta se inyecta como
 * en las suites E2 vigentes; el `IngresoTesoreria` (G11) llega por listener.
 */
export async function crearCompraPagada(opciones: {
  lineas?: LineaCompra[];
  cuenta?: CuentaFixture;
  passwordHash?: string;
} = {}): Promise<CompraPagada> {
  const cuenta = opciones.cuenta ?? await crearCuenta(opciones.passwordHash);
  const lineas = opciones.lineas ?? [{ cantidad: 1 }];
  const depositoId = await depositoCanalWeb();
  const articulos: CompraPagada["articulos"] = [];
  const stockInicial = new Map<string, number>();
  for (const linea of lineas) {
    const stock = 10;
    const articulo = await fixturesE1.crearArticulo(prisma, {
      stockShowroom: depositoId === DEPOSITO_SHOWROOM_ID ? stock : 0,
      stockCentral: depositoId === DEPOSITO_CENTRAL_ID ? stock : undefined,
      precio: linea.precio ?? 5000,
    });
    stockInicial.set(articulo.varianteId, stock);
    await agregarAlCarrito({ cuentaId: cuenta.cuentaId }, { variante_sku_id: articulo.varianteId, cantidad: linea.cantidad });
    articulos.push({ variante_sku_id: articulo.varianteId, sku: articulo.sku, cantidad: linea.cantidad });
  }
  const pedido = await iniciarCheckout(cuenta.sesion);
  const paymentId = `t17-${randomUUID()}`;
  const resultado = await notificarPagoAprobado({
    payment_id: paymentId,
    pedido_venta_ecommerce_id: pedido.pedido_venta_ecommerce_id,
    total: pedido.total,
  });
  assert.equal(resultado.resultado, "CONFIRMADO");
  await esperarHasta(
    async () => (await prisma.ingresoTesoreria.count({ where: { pedido_venta_id: pedido.pedido_venta_id } })) === 1,
    "IngresoTesoreria G11 del pago",
  );
  const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: cuenta.clienteId }, select: { dni: true } });
  return {
    pedido_venta_id: pedido.pedido_venta_id,
    pedido_venta_ecommerce_id: pedido.pedido_venta_ecommerce_id,
    numero_venta: pedido.numero_venta,
    total: pedido.total,
    payment_id: paymentId,
    cuenta,
    dni: cliente.dni,
    deposito_id: depositoId,
    articulos,
    stock_inicial: stockInicial,
  };
}

/** Escanea cada unidad de cada línea con el SKU real del ítem. */
export async function escanearTodo(pedidoVentaId: string, operadorId: string): Promise<void> {
  const items = await prisma.pedidoVentaItem.findMany({
    where: { pedido_venta_id: pedidoVentaId },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    select: { cantidad: true, variante_sku: { select: { sku: true } } },
  });
  for (const item of items) {
    for (let i = 0; i < item.cantidad; i++) {
      await confirmarItem(pedidoVentaId, operadorId, { scan_id: randomUUID(), codigo: item.variante_sku.sku });
    }
  }
}

/** PAGO_CONFIRMADO → tomar → scans → completar: LISTO_PARA_RETIRO real. */
export async function prepararHastaListo(pedidoVentaId: string, operadorId: string): Promise<void> {
  await tomarPedido(pedidoVentaId, operadorId);
  await escanearTodo(pedidoVentaId, operadorId);
  const completado = await completarPreparacion(pedidoVentaId, operadorId);
  assert.equal(completado.estado_ecommerce, "LISTO_PARA_RETIRO");
}

/**
 * Avance de reloj sobre un plazo ya calculado por E12: el único campo tocado
 * es `plazo_retiro_vencimiento` (equivalente a dejar pasar el tiempo).
 */
export async function avanzarRelojPlazo(pedidoVentaId: string, plazo: Date): Promise<void> {
  const cambio = await prisma.pedidoVentaEcommerce.updateMany({
    where: { pedido_venta_id: pedidoVentaId, estado_ecommerce: "LISTO_PARA_RETIRO", is_active: true },
    data: { plazo_retiro_vencimiento: plazo },
  });
  assert.equal(cambio.count, 1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Precondiciones no producibles por el código vigente
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pedido pagado legacy: anterior a `TransaccionPagoLog`, con evidencia durable
 * completa (cobro MERCADO_PAGO, factura total, reserva cerrada + EGRESO
 * RESERVADO→VENDIDO e ingreso G11). `contradictorio` agrega un log RECHAZADO
 * del mismo pago: evidencia explícitamente contradictoria (T07 debe rechazar).
 */
export async function crearPedidoLegacy(opciones: {
  estado: "PAGO_CONFIRMADO" | "EN_PREPARACION" | "LISTO_PARA_RETIRO";
  plazo?: Date;
  operadorId?: string;
  contradictorio?: boolean;
  cuenta?: CuentaFixture;
}): Promise<CompraPagada> {
  const cuenta = opciones.cuenta ?? await crearCuenta();
  const canalWeb = await prisma.usuario.findFirstOrThrow({ where: { nombre_usuario: "canal.web.sistema" }, select: { id: true } });
  const articulo = await fixturesE1.crearArticulo(prisma, { stockShowroom: 9, precio: 4000 });
  const paymentId = `t17-legacy-${randomUUID()}`;
  const total = 4000;
  const ahora = new Date();
  const pedido = await prisma.pedidoVenta.create({
    data: {
      numero_venta: `T17-LEG-${randomUUID().slice(0, 8)}`,
      cliente_id: cuenta.clienteId,
      canal: "WEB",
      estado: "FACTURADO",
      total,
      fecha_facturacion: ahora,
      registrado_por_id: canalWeb.id,
    },
  });
  const ecommerce = await prisma.pedidoVentaEcommerce.create({
    data: {
      pedido_venta_id: pedido.id,
      estado_ecommerce: opciones.estado,
      mercadopago_payment_id: paymentId,
      fecha_pago_confirmado: ahora,
      operador_asignado_id: opciones.estado === "PAGO_CONFIRMADO" ? null : opciones.operadorId ?? null,
      codigo_qr_retiro: opciones.estado === "LISTO_PARA_RETIRO" ? createHash("sha256").update(randomUUID()).digest("hex") : null,
      plazo_retiro_vencimiento: opciones.estado === "LISTO_PARA_RETIRO" ? opciones.plazo ?? new Date(Date.now() + 86_400_000) : null,
    },
  });
  if (opciones.contradictorio) {
    await prisma.transaccionPagoLog.create({
      data: {
        pedido_venta_ecommerce_id: ecommerce.id,
        mercadopago_payment_id: paymentId,
        monto: total,
        estado_pago: "RECHAZADO",
        resultado_webhook: "{}",
        datos_facturacion_cifrados: "fixture-t17",
        datos_facturacion_iv: "fixture-t17",
      },
    });
  }
  await prisma.ventaMedioPago.create({
    data: { pedido_venta_id: pedido.id, medio: "MERCADO_PAGO", importe: total, referencia: paymentId },
  });
  await prisma.comprobanteFiscal.create({
    data: {
      pedido_venta_id: pedido.id,
      tipo_comprobante: "FACTURA_B",
      cae_simulado: "68031598270017",
      qr_data_url: "data:image/png;base64,T17-LEGACY==",
      es_simulado: true,
      monto_total: total,
      emitido_por_id: canalWeb.id,
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      variante_sku_id: articulo.varianteId,
      deposito_id: DEPOSITO_SHOWROOM_ID,
      cantidad: 1,
      fecha_inicio_reserva: new Date(ahora.getTime() - 60_000),
      fecha_fin_reserva: ahora,
      fecha_expiracion: new Date(ahora.getTime() + 3_600_000),
      motivo: `Checkout web — ${pedido.numero_venta}`,
      registrado_por_id: canalWeb.id,
    },
  });
  await prisma.pedidoVentaItem.create({
    data: {
      pedido_venta_id: pedido.id,
      variante_sku_id: articulo.varianteId,
      cantidad: 1,
      precio_unitario: total,
      reserva_id: reserva.id,
      cantidad_facturada: 1,
    },
  });
  await prisma.movimientoStock.create({
    data: {
      deposito_origen_id: DEPOSITO_SHOWROOM_ID,
      tipo_movimiento: "EGRESO",
      comprobante_referencia: `RESERVA-CONFIRMADA-${reserva.id}`,
      registrado_por_id: canalWeb.id,
      venta_id: pedido.id,
      items: { create: { variante_sku_id: articulo.varianteId, cantidad: 1, estado_origen: "RESERVADO", estado_destino: "VENDIDO" } },
    },
  });
  await prisma.ingresoTesoreria.create({
    data: { pedido_venta_id: pedido.id, mercadopago_payment_id: paymentId, monto: total, fecha: ahora },
  });
  const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: cuenta.clienteId }, select: { dni: true } });
  return {
    pedido_venta_id: pedido.id,
    pedido_venta_ecommerce_id: ecommerce.id,
    numero_venta: pedido.numero_venta,
    total,
    payment_id: paymentId,
    cuenta,
    dni: cliente.dni,
    deposito_id: DEPOSITO_SHOWROOM_ID,
    articulos: [{ variante_sku_id: articulo.varianteId, sku: articulo.sku, cantidad: 1 }],
    // Stock previo a la venta legacy: 9 disponibles + 1 vendido.
    stock_inicial: new Map([[articulo.varianteId, 10]]),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Conteos de efectos e invariantes globales
// ──────────────────────────────────────────────────────────────────────────────

export interface EfectosPedido {
  sagas: number;
  notas_credito: number;
  originales: number;
  compensaciones: number;
  compensaciones_completas: number;
  movimientos_compensacion: number;
  contra_asientos: number;
  intentos: number;
  intentos_iniciales: number;
  intentos_aprobados: number;
  transacciones_pago: number;
  notificaciones_e13: number;
  auditorias_terminales: number;
}

export const EVENTOS_F3_HU_E13 = [
  "ecommerce:pedido_cancelado",
  "ecommerce:pedido_vencido_sin_retiro",
  "ecommerce:plazo_retiro_por_vencer",
] as const;

export async function efectos(compra: CompraPagada): Promise<EfectosPedido> {
  const pid = compra.pedido_venta_id;
  const saga = await prisma.reintegroPedidoWeb.findUnique({ where: { pedido_venta_id: pid }, select: { id: true } });
  const [sagas, notas, originales, compensaciones, completas, movimientos, contra, intentos, iniciales, aprobados, logs] = await Promise.all([
    prisma.reintegroPedidoWeb.count({ where: { pedido_venta_id: pid } }),
    prisma.comprobanteFiscal.count({ where: { pedido_venta_id: pid, tipo_comprobante: "NOTA_CREDITO" } }),
    prisma.comprobanteFiscal.count({ where: { pedido_venta_id: pid, tipo_comprobante: { not: "NOTA_CREDITO" } } }),
    prisma.reintegroStockCompensacion.count({ where: { reintegro: { pedido_venta_id: pid } } }),
    prisma.reintegroStockCompensacion.count({
      where: { reintegro: { pedido_venta_id: pid }, movimiento_stock_id: { not: null }, completed_at: { not: null } },
    }),
    prisma.movimientoStock.count({ where: { venta_id: pid, comprobante_referencia: { startsWith: `HU-E13:STOCK:${pid}:` } } }),
    prisma.contraAsientoIngreso.count({ where: { pedido_venta_id: pid } }),
    prisma.reintegroRefundIntento.count({ where: { reintegro: { pedido_venta_id: pid } } }),
    prisma.reintegroRefundIntento.count({ where: { reintegro: { pedido_venta_id: pid }, origen: "INICIAL" } }),
    prisma.reintegroRefundIntento.count({ where: { reintegro: { pedido_venta_id: pid }, estado: "APROBADO" } }),
    prisma.transaccionPagoLog.count({ where: { pedido_venta_ecommerce_id: compra.pedido_venta_ecommerce_id } }),
  ]);
  const [notificaciones, auditorias] = saga
    ? await Promise.all([
        prisma.notificacion.count({
          where: {
            clave_idempotencia: {
              in: ["ecommerce:pedido_cancelado", "ecommerce:pedido_vencido_sin_retiro"].map((tipo) =>
                claveF3(tipo, saga.id, compra.cuenta.cuentaId)),
            },
          },
        }),
        prisma.auditLog.count({
          where: { accion: { in: ["PEDIDO_PAGADO_CANCELADO", "PEDIDO_VENCIDO_SIN_RETIRO"] }, registro_id: saga.id },
        }),
      ])
    : [0, 0];
  return {
    sagas,
    notas_credito: notas,
    originales,
    compensaciones,
    compensaciones_completas: completas,
    movimientos_compensacion: movimientos,
    contra_asientos: contra,
    intentos,
    intentos_iniciales: iniciales,
    intentos_aprobados: aprobados,
    transacciones_pago: logs,
    notificaciones_e13: notificaciones,
    auditorias_terminales: auditorias,
  };
}

/** Clave F3 del contrato (spec F §2.3): sha256(tipo_evento:clave_origen:destinatario_id). */
export function claveF3(tipoEvento: string, claveOrigen: string, destinatarioId: string): string {
  return createHash("sha256").update(`${tipoEvento}:${claveOrigen}:${destinatarioId}`).digest("hex");
}

/** Usuarios internos activos con un rol dado (para probar ausencia de F3 a ese rol). */
export async function usuariosConRol(nombreRol: string): Promise<string[]> {
  const usuarios = await prisma.usuario.findMany({
    where: {
      is_active: true,
      deleted_at: null,
      roles: { some: { is_active: true, rol: { nombre: nombreRol, is_active: true } } },
    },
    select: { id: true },
  });
  return usuarios.map(({ id }) => id);
}

/** Snapshot inmutable del comprobante original y de la venta B. */
export async function snapshotFiscal(pedidoVentaId: string) {
  const [original, venta] = await Promise.all([
    prisma.comprobanteFiscal.findFirstOrThrow({ where: { pedido_venta_id: pedidoVentaId, tipo_comprobante: { not: "NOTA_CREDITO" } } }),
    prisma.pedidoVenta.findUniqueOrThrow({
      where: { id: pedidoVentaId },
      select: { estado: true, total: true, cliente_id: true, is_active: true, deleted_at: true, fecha_facturacion: true },
    }),
  ]);
  return { original, venta };
}

export async function stockDisponible(varianteId: string, depositoId: string): Promise<number> {
  const fila = await prisma.stockDeposito.findFirstOrThrow({
    where: { variante_sku_id: varianteId, deposito_id: depositoId, is_active: true, deleted_at: null },
    select: { cantidad: true },
  });
  return fila.cantidad;
}

/**
 * Invariantes globales de §2.13.13 sobre un pedido terminal HU-E13 con pasos
 * locales completos: B intacto, original inmutable, NC única vinculada, una
 * compensación por línea con stock restituido exacto, un contra-asiento total,
 * a lo sumo un refund aprobado y sin borrado físico.
 */
export async function verificarTerminalCompensado(
  compra: CompraPagada,
  fiscalPrevio: Awaited<ReturnType<typeof snapshotFiscal>>,
  estadoFinal: "CANCELADO" | "VENCIDO_SIN_RETIRO",
): Promise<void> {
  const pid = compra.pedido_venta_id;
  const fiscal = await snapshotFiscal(pid);
  assert.deepEqual(fiscal.original, fiscalPrevio.original, "la factura original es inmutable");
  assert.deepEqual(fiscal.venta, fiscalPrevio.venta, "PedidoVenta B permanece FACTURADO, activo y del mismo cliente");
  assert.equal(fiscal.venta.estado, "FACTURADO");

  const extension = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
  assert.equal(extension.estado_ecommerce, estadoFinal);
  assert.equal(extension.codigo_qr_retiro, null);
  assert.equal(extension.is_active, false);
  assert.ok(extension.deleted_at);
  assert.ok(extension.deleted_by);

  const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
  assert.equal(saga.mercadopago_payment_id, compra.payment_id);
  assert.ok(saga.monto_total.equals(compra.total));
  const nota = await prisma.comprobanteFiscal.findUniqueOrThrow({ where: { id: saga.nota_credito_id! } });
  assert.equal(nota.tipo_comprobante, "NOTA_CREDITO");
  assert.equal(nota.comprobante_original_id, fiscalPrevio.original.id);
  assert.ok(nota.monto_total.equals(compra.total));
  assert.equal(nota.pedido_venta_id, pid);

  const compensaciones = await prisma.reintegroStockCompensacion.findMany({
    where: { reintegro_id: saga.id },
    include: { movimiento_stock: { include: { items: true } }, pedido_venta_item: { select: { cantidad: true, variante_sku_id: true } } },
  });
  assert.equal(compensaciones.length, compra.articulos.length);
  for (const compensacion of compensaciones) {
    assert.ok(compensacion.completed_at);
    assert.equal(compensacion.clave_idempotencia, `HU-E13:STOCK:${pid}:${compensacion.pedido_venta_item_id}`);
    assert.equal(compensacion.deposito_id, compra.deposito_id);
    assert.equal(compensacion.cantidad, compensacion.pedido_venta_item.cantidad);
    const movimiento = compensacion.movimiento_stock!;
    assert.equal(movimiento.tipo_movimiento, "INGRESO");
    assert.equal(movimiento.deposito_destino_id, compra.deposito_id);
    assert.deepEqual(movimiento.items.map((i) => [i.variante_sku_id, i.cantidad, i.estado_origen, i.estado_destino]), [
      [compensacion.variante_sku_id, compensacion.cantidad, "VENDIDO", "DISPONIBLE"],
    ]);
  }
  for (const articulo of compra.articulos) {
    assert.equal(
      await stockDisponible(articulo.variante_sku_id, compra.deposito_id),
      compra.stock_inicial.get(articulo.variante_sku_id),
      "stock VENDIDO → DISPONIBLE restituido exactamente una vez",
    );
  }

  const contra = await prisma.contraAsientoIngreso.findUniqueOrThrow({ where: { id: saga.contra_asiento_ingreso_id! } });
  const ingreso = await prisma.ingresoTesoreria.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
  assert.equal(contra.ingreso_original_id, ingreso.id);
  assert.ok(contra.monto.equals(compra.total));

  const e = await efectos(compra);
  assert.equal(e.sagas, 1);
  assert.equal(e.notas_credito, 1);
  assert.equal(e.originales, 1);
  assert.equal(e.movimientos_compensacion, compra.articulos.length);
  assert.equal(e.compensaciones_completas, compra.articulos.length);
  assert.equal(e.contra_asientos, 1);
  assert.equal(e.intentos_iniciales, 1);
  assert.ok(e.intentos_aprobados <= 1);
}

/** Ningún dato sensible en Notificacion/AuditLog HU-E13 ni en respuestas públicas. */
export function assertSinSecretos(texto: string, compra: CompraPagada, extras: string[] = []): void {
  const prohibidos = [compra.payment_id, compra.dni, compra.cuenta.email, ...extras].filter(Boolean);
  for (const prohibido of prohibidos) assert.ok(!texto.includes(prohibido), `dato sensible expuesto: ${prohibido.slice(0, 8)}…`);
  assert.doesNotMatch(texto, /HU-E13:REFUND:|clave_idempotencia|access_token|Bearer |T17-REF-|SIM-REF-|ultimo_error|error_codigo/);
}

/** Claves exactas del detalle E9 tras el addendum post-T17 (SPEC §2.13.16.2–.3). */
const CLAVES_DETALLE_E9 = [
  "comprobante", "estado", "fecha", "fecha_terminacion", "id", "items", "motivo", "nota_credito",
  "numero", "plazo_retiro_vencimiento", "qr_data_url", "reintegro_estado", "total",
];

/**
 * Contrato E9 post-T17 de un terminal HU-E13, contrastado con la base:
 * motivo/fecha de la baja lógica, estado agregado de la saga, comprobante
 * ORIGINAL (nunca la NC) y NC vinculada por separado, sin IDs internos.
 */
export async function verificarE9Terminal(
  detalle: Record<string, unknown>,
  compra: CompraPagada,
  esperado: { estado: "CANCELADO" | "VENCIDO_SIN_RETIRO"; motivo: string; reintegro_estado: "PENDIENTE" | "APROBADO" | "RECHAZADO" },
): Promise<void> {
  const pid = compra.pedido_venta_id;
  const ext = await prisma.pedidoVentaEcommerce.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
  const saga = await prisma.reintegroPedidoWeb.findUniqueOrThrow({ where: { pedido_venta_id: pid } });
  const originales = await prisma.comprobanteFiscal.findMany({
    where: { pedido_venta_id: pid, tipo_comprobante: { not: "NOTA_CREDITO" } },
  });
  assert.equal(originales.length, 1);
  const original = originales[0]!;
  const nc = await prisma.comprobanteFiscal.findUniqueOrThrow({ where: { id: saga.nota_credito_id! } });
  assert.equal(nc.comprobante_original_id, original.id);

  assert.deepEqual(Object.keys(detalle).sort(), CLAVES_DETALLE_E9);
  assert.equal(detalle.estado, esperado.estado);
  assert.equal(detalle.motivo, esperado.motivo);
  assert.equal(detalle.motivo, ext.deletion_reason);
  assert.equal(detalle.fecha_terminacion, ext.deleted_at!.toISOString());
  assert.equal(detalle.reintegro_estado, esperado.reintegro_estado);
  assert.equal(detalle.reintegro_estado, saga.estado);
  assert.equal(detalle.qr_data_url, null);
  assert.deepEqual(detalle.comprobante, {
    tipo: original.tipo_comprobante,
    fecha_emision: original.created_at.toISOString(),
    monto: original.monto_total.toNumber(),
  });
  assert.deepEqual(detalle.nota_credito, {
    tipo: "NOTA_CREDITO",
    fecha_emision: nc.created_at.toISOString(),
    monto: nc.monto_total.toNumber(),
  });
  const texto = JSON.stringify(detalle);
  for (const id of [original.id, nc.id, saga.id, saga.contra_asiento_ingreso_id ?? "", saga.intento_aprobado_id ?? ""].filter(Boolean)) {
    assert.ok(!texto.includes(id), "E9 expone un ID interno");
  }
  assertSinSecretos(texto, compra);
}
