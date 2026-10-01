/**
 * HU-E1 — Checkout parcial (docs/tasks/HU-E1.md, D1 aprobada; spec_modulo_E.md
 * §2.2 pasos 1, 3 y 4). Valida, reserva y deja el pedido en Pago Pendiente.
 * SIN cupón (HU-E4) ni Mercado Pago (HU-E2): `checkout_url` sale en `null`.
 *
 * Estados SOLO del enum existente: `PedidoVenta.estado = RESERVADO` (spec B
 * §3.1) y `PedidoVentaEcommerce.estado_ecommerce = PAGO_PENDIENTE` (spec E §3.1).
 *
 * Concurrencia — dos checkouts sobre la última unidad (CA "sin sobreventa"):
 * todo ocurre en UNA `$transaction` (READ COMMITTED de PostgreSQL) y la
 * garantía la dan dos `updateMany` condicionales, sin `SELECT ... FOR UPDATE`:
 *  1. Reserva (`crearReservaTx`, Módulo A): `UPDATE stock_depositos SET
 *     cantidad = cantidad - n WHERE ... AND cantidad >= n`. PostgreSQL toma el
 *     lock de la fila; la segunda transacción espera, y al liberarse el lock
 *     REEVALÚA el `WHERE` contra la fila ya commiteada → `count = 0` →
 *     `STOCK_INSUFICIENTE` → rollback completo (ninguna reserva ni pedido).
 *     El stock nunca queda negativo ni se reserva dos veces la misma unidad.
 *  2. Conversión del carrito (D10): `UPDATE carritos_web SET is_active = false
 *     WHERE id = ? AND is_active = true` es la PRIMERA sentencia: dos checkouts
 *     del mismo carrito se serializan ahí; el segundo ve `count = 0` y en vez
 *     de reservar otra vez devuelve el pedido que creó el primero para ESE
 *     carrito (caso 2 de D10, sin duplicar).
 *
 * D10 — la idempotencia se decide por el CARRITO, no por la cuenta (regla
 * aprobada por el owner, 2026-10-01):
 *  1. Carrito activo con ítems → checkout normal (pedido NUEVO, el carrito pasa
 *     a "convertido en pedido"). Puede coexistir con otros pedidos Pago
 *     Pendiente vigentes de la misma cuenta.
 *  2. Sin carrito activo con ítems y con un pedido Pago Pendiente vigente → se
 *     devuelve ese pedido (doble clic), sin reservar.
 *  3. Ni carrito con ítems ni pedido vigente → 422 CARRITO_VACIO.
 *
 * D4.2: antes de reservar, libera DENTRO de la misma transacción las reservas
 * vencidas (`fecha_expiracion <= now()`) de los SKU del carrito en el depósito
 * web (`liberarReservasVencidasTx`, Módulo A), aunque el job no haya corrido.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { CarritoArticuloNoDisponiblePayload } from "@/lib/events/event-types";
import type { ReservaCongeladaPayload } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import { resolverVariantesWeb } from "@/lib/services/ecommerce/catalogo-web.service";
import {
  derivarEstadoVisiblePedidoWeb,
  type EstadoVisiblePedidoWeb,
} from "@/lib/services/ecommerce/pedido-web.reglas";
import {
  crearReservaTx,
  emitirReservaCongelada,
  emitirReservasLiberadasTtl,
  liberarReservasVencidasTx,
  type ReservaLiberadaTtl,
} from "@/lib/services/inventario/reserva.service";
import { obtenerDepositoCanalWebId, obtenerTtlCheckoutHoras } from "@/lib/services/sistema/configuracion.service";
import { crearPedidoVentaReservadoTx } from "@/lib/services/ventas/pedido-venta.service";

/** `deletion_reason` del carrito convertido en pedido (D10). */
export const MOTIVO_CARRITO_CONVERTIDO = "convertido en pedido";

/**
 * `Reserva.motivo` de las reservas de un checkout: identifica el carrito de
 * origen. Lo usa D10 caso 2 en la carrera del doble clic para devolver el
 * pedido de ESE carrito (no "el último de la cuenta": puede haber varios
 * pedidos Pago Pendiente vigentes).
 */
export const motivoReservaCheckout = (carritoId: string) => `Checkout web — carrito ${carritoId}`;
/** Usuario de sistema registrante de los PedidoVenta de canal WEB (spec E §2.2, seed). */
export const NOMBRE_USUARIO_CANAL_WEB = "canal.web.sistema";

const REINTENTOS_NUMERO_VENTA = 3;
const TIMEOUT_TRANSACCION_MS = 15_000;

export interface SesionCheckout {
  cuentaId: string;
  clienteId: string;
  vinculacionPendiente: boolean;
}

export interface CheckoutIniciado {
  pedido_venta_id: string;
  numero_venta: string;
  estado_ecommerce: "PAGO_PENDIENTE";
  total: number;
  /** Vencimiento de la reserva (ventana de pago, `ECOMMERCE_CHECKOUT_TTL_HORAS`). */
  ttl_expiracion: string;
  /** HU-E2 completa la preferencia de Mercado Pago; en E1 siempre `null`. */
  checkout_url: null;
  /** `true` si se devolvió un pedido Pago Pendiente vigente ya existente (D10). */
  reutilizado: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// D10 — pedidos Pago Pendiente vigentes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pedido web Pago Pendiente de la cuenta cuyas reservas siguen VIGENTES (todas
 * activas, sin cerrar y con `fecha_expiracion > ahora`); el más reciente. Un
 * pedido con alguna reserva vencida NO cuenta, aunque el job todavía no la
 * haya liberado (D4.2). Con `carritoId`, solo el pedido originado por ese
 * carrito (`Reserva.motivo`, ver `motivoReservaCheckout`).
 */
export async function buscarPedidoPendienteVigente(
  clienteId: string,
  ahora: Date = new Date(),
  carritoId?: string,
): Promise<CheckoutIniciado | null> {
  const reservaVigente = {
    is_active: true,
    deleted_at: null,
    fecha_fin_reserva: null,
    fecha_expiracion: { gt: ahora },
  } satisfies Prisma.ReservaWhereInput;

  const pendiente = await prisma.pedidoVentaEcommerce.findFirst({
    where: {
      estado_ecommerce: "PAGO_PENDIENTE",
      is_active: true,
      deleted_at: null,
      pedido_venta: {
        cliente_id: clienteId,
        canal: "WEB",
        estado: "RESERVADO",
        is_active: true,
        deleted_at: null,
        items: {
          some: {
            is_active: true,
            reserva: { is: carritoId ? { ...reservaVigente, motivo: motivoReservaCheckout(carritoId) } : reservaVigente },
          },
          every: { OR: [{ is_active: false }, { reserva: { is: reservaVigente } }] },
        },
      },
    },
    orderBy: { created_at: "desc" },
    select: {
      pedido_venta: {
        select: {
          id: true,
          numero_venta: true,
          total: true,
          items: { where: { is_active: true }, select: { reserva: { select: { fecha_expiracion: true } } } },
        },
      },
    },
  });
  if (!pendiente) return null;

  const vencimientos = pendiente.pedido_venta.items
    .map((i) => i.reserva?.fecha_expiracion.getTime())
    .filter((t): t is number => t !== undefined);

  return {
    pedido_venta_id: pendiente.pedido_venta.id,
    numero_venta: pendiente.pedido_venta.numero_venta,
    estado_ecommerce: "PAGO_PENDIENTE",
    total: pendiente.pedido_venta.total.toNumber(),
    ttl_expiracion: new Date(Math.min(...vencimientos)).toISOString(),
    checkout_url: null,
    reutilizado: true,
  };
}

export interface PedidoWebPendienteVista {
  pedido_venta_id: string;
  numero_venta: string;
  total: number;
  ttl_expiracion: string;
  /** Derivado de `ttl_expiracion` — NO es un estado persistido (ver pedido-web.reglas.ts). */
  estado_visible: EstadoVisiblePedidoWeb;
}

/**
 * Pedido web Pago Pendiente por id, SOLO si pertenece al cliente de la sesión
 * (un id ajeno o inexistente devuelve `null`, igual que spec E §2.9). Es el
 * pedido que devolvió el checkout, para `/tienda/checkout/pendiente`. Si su
 * reserva venció (aunque el job no la haya liberado y E7 todavía no lo haya
 * anulado) sale con `estado_visible = "RESERVA_VENCIDA"`. Solo lectura.
 */
export async function obtenerPedidoWebPendiente(
  pedidoVentaId: string,
  clienteId: string,
  ahora: Date = new Date(),
): Promise<PedidoWebPendienteVista | null> {
  const pendiente = await prisma.pedidoVentaEcommerce.findFirst({
    where: {
      estado_ecommerce: "PAGO_PENDIENTE",
      is_active: true,
      deleted_at: null,
      pedido_venta: { id: pedidoVentaId, cliente_id: clienteId, canal: "WEB", is_active: true, deleted_at: null },
    },
    select: {
      pedido_venta: {
        select: {
          id: true,
          numero_venta: true,
          total: true,
          items: { where: { is_active: true }, select: { reserva: { select: { fecha_expiracion: true } } } },
        },
      },
    },
  });
  if (!pendiente) return null;

  const vencimientos = pendiente.pedido_venta.items
    .map((i) => i.reserva?.fecha_expiracion.getTime())
    .filter((t): t is number => t !== undefined);
  // Sin reservas (no debería ocurrir en un pedido web) = nada que pagar: vencida.
  const ttl = new Date(vencimientos.length > 0 ? Math.min(...vencimientos) : 0);

  return {
    pedido_venta_id: pendiente.pedido_venta.id,
    numero_venta: pendiente.pedido_venta.numero_venta,
    total: pendiente.pedido_venta.total.toNumber(),
    ttl_expiracion: ttl.toISOString(),
    estado_visible: derivarEstadoVisiblePedidoWeb(ttl, ahora),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Checkout
// ──────────────────────────────────────────────────────────────────────────────

interface ResultadoTransaccion {
  respuesta: CheckoutIniciado;
  carritoId: string;
  pedidoVentaEcommerceId: string;
  reservas: ReservaCongeladaPayload[];
  liberadas: ReservaLiberadaTtl[];
  convertidoEn: Date;
}

/** Error interno: otra transacción ya convirtió este carrito (D10). */
const CHECKOUT_CONCURRENTE = "CHECKOUT_CONCURRENTE";

/**
 * Inicia el checkout de la cuenta (CA4/CA5/CA6 de HU-E1) con la regla D10 por
 * carrito (ver cabecera).
 *
 * @throws {ServiceError} CUENTA_VINCULACION_PENDIENTE (403)
 * @throws {ServiceError} CARRITO_VACIO (422) — D10 caso 3
 * @throws {ServiceError} ARTICULO_NO_DISPONIBLE (422, `details.items[]`) — emite
 *         `ecommerce:carrito_articulo_no_disponible` por ítem (CA4)
 * @throws {ServiceError} STOCK_INSUFICIENTE (422, `details.items[]`) — no notifica (D6)
 * @throws {ServiceError} CHECKOUT_EN_CURSO (409) — carrera sin pedido vigente que devolver
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CANAL_WEB_NO_CONFIGURADO | CANAL_WEB_SIN_USUARIO_SISTEMA
 */
export async function iniciarCheckout(sesion: SesionCheckout): Promise<CheckoutIniciado> {
  if (sesion.vinculacionPendiente) {
    throw new ServiceError(
      "CUENTA_VINCULACION_PENDIENTE",
      "Tu cuenta está pendiente de validación en sucursal: todavía no podés comprar online",
    );
  }

  // D10 — se decide por el carrito.
  const carrito = await prisma.carritoWeb.findFirst({
    where: {
      cuenta_cliente_web_id: sesion.cuentaId,
      is_active: true,
      deleted_at: null,
      items: { some: { is_active: true, deleted_at: null } },
    },
    select: { id: true },
  });
  if (!carrito) {
    // Caso 2 (doble clic: el carrito ya se convirtió) o caso 3.
    const vigente = await buscarPedidoPendienteVigente(sesion.clienteId);
    if (vigente) return vigente;
    throw new ServiceError("CARRITO_VACIO", "Tu carrito está vacío");
  }

  const [depositoId, ttlHoras, usuarioCanalWeb] = await Promise.all([
    obtenerDepositoCanalWebId(),
    obtenerTtlCheckoutHoras(),
    prisma.usuario.findFirst({
      where: { nombre_usuario: NOMBRE_USUARIO_CANAL_WEB, is_active: true, deleted_at: null },
      select: { id: true },
    }),
  ]);
  if (!usuarioCanalWeb) {
    throw new ServiceError(
      "CANAL_WEB_SIN_USUARIO_SISTEMA",
      `No existe el usuario de sistema ${NOMBRE_USUARIO_CANAL_WEB} (registrante de los pedidos web)`,
    );
  }

  let resultado: ResultadoTransaccion | null = null;
  for (let intento = 1; resultado === null; intento++) {
    try {
      resultado = await ejecutarTransaccionCheckout(sesion, carrito.id, depositoId, ttlHoras, usuarioCanalWeb.id);
    } catch (error) {
      if (error instanceof ServiceError && error.code === "ARTICULO_NO_DISPONIBLE") {
        // CA4: la transacción se revirtió (el carrito sigue intacto); se avisa
        // al cliente por cada ítem afectado, después del rollback.
        const eventos = (error.details as { eventos: CarritoArticuloNoDisponiblePayload[] }).eventos;
        for (const evento of eventos) domainEventBus.emit("ecommerce:carrito_articulo_no_disponible", evento);
        throw new ServiceError(error.code, error.message, {
          items: eventos.map(({ carrito_item_id, variante_sku_id, sku, motivo }) => ({
            item_id: carrito_item_id,
            variante_sku_id,
            sku,
            motivo,
          })),
        });
      }
      if (error instanceof ServiceError && error.code === CHECKOUT_CONCURRENTE) {
        // D10 caso 2 en carrera: otra request ya convirtió ESTE carrito — se
        // devuelve el pedido de ese carrito (no otro pedido de la cuenta).
        const creadoPorOtro = await buscarPedidoPendienteVigente(sesion.clienteId, new Date(), carrito.id);
        if (creadoPorOtro) return creadoPorOtro;
        throw new ServiceError("CHECKOUT_EN_CURSO", "Ya hay una compra en curso para tu carrito; reintentá en unos segundos");
      }
      const colisionNumero =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        JSON.stringify(error.meta?.target ?? "").includes("numero_venta");
      if (colisionNumero && intento < REINTENTOS_NUMERO_VENTA) continue;
      throw error;
    }
  }

  // Regla de emisión: TODOS los eventos después del commit.
  emitirReservasLiberadasTtl(resultado.liberadas);
  for (const reserva of resultado.reservas) emitirReservaCongelada(reserva);
  domainEventBus.emit("ecommerce:checkout_iniciado", {
    pedido_venta_id: resultado.respuesta.pedido_venta_id,
    pedido_venta_ecommerce_id: resultado.pedidoVentaEcommerceId,
    numero_venta: resultado.respuesta.numero_venta,
    cliente_web_cuenta_id: sesion.cuentaId,
    carrito_id: resultado.carritoId,
    reserva_ids: resultado.reservas.map((r) => r.reserva_id),
    ttl_expiracion: resultado.respuesta.ttl_expiracion,
  });
  domainEventBus.emit("ecommerce:carrito_convertido_en_pedido", {
    carrito_id: resultado.carritoId,
    pedido_venta_id: resultado.respuesta.pedido_venta_id,
    cliente_web_cuenta_id: sesion.cuentaId,
    deleted_at: resultado.convertidoEn.toISOString(),
    deletion_reason: MOTIVO_CARRITO_CONVERTIDO,
  });

  return resultado.respuesta;
}

async function ejecutarTransaccionCheckout(
  sesion: SesionCheckout,
  carritoId: string,
  depositoId: string,
  ttlHoras: number,
  usuarioCanalWebId: string,
): Promise<ResultadoTransaccion> {
  const carrito = { id: carritoId };

  return prisma.$transaction(
    async (tx) => {
      const ahora = new Date();

      // (1) D10 — conversión del carrito, PRIMERA sentencia: toma el lock de la
      // fila y serializa dos checkouts del mismo carrito.
      const conversion = await tx.carritoWeb.updateMany({
        where: { id: carrito.id, is_active: true, deleted_at: null },
        data: {
          is_active: false,
          deleted_at: ahora,
          deleted_by: sesion.cuentaId,
          deletion_reason: MOTIVO_CARRITO_CONVERTIDO,
        },
      });
      if (conversion.count === 0) throw new ServiceError(CHECKOUT_CONCURRENTE);

      // (2) Ítems leídos con el carrito ya bloqueado.
      const items = await tx.carritoWebItem.findMany({
        where: { carrito_id: carrito.id, is_active: true, deleted_at: null },
        select: { id: true, variante_sku_id: true, cantidad: true },
        orderBy: { created_at: "asc" },
      });
      if (items.length === 0) throw new ServiceError("CARRITO_VACIO", "Tu carrito está vacío");

      // (3) Paso 1 de spec §2.2 — comprabilidad + precio vigente, con el MISMO
      // predicado que el catálogo (D6). Se informan TODOS los ítems afectados.
      const vistas = await resolverVariantesWeb(items.map((i) => i.variante_sku_id), depositoId);
      const noDisponibles: CarritoArticuloNoDisponiblePayload[] = [];
      for (const item of items) {
        const vista = vistas.get(item.variante_sku_id);
        if (vista?.comprable && vista.precio_venta_decimal) continue;
        noDisponibles.push({
          carrito_id: carrito.id,
          carrito_item_id: item.id,
          variante_sku_id: item.variante_sku_id,
          sku: vista?.sku ?? item.variante_sku_id,
          motivo: vista?.motivo ?? "SKU_INACTIVO",
          cliente_web_cuenta_id: sesion.cuentaId,
        });
      }
      if (noDisponibles.length > 0) {
        throw new ServiceError(
          "ARTICULO_NO_DISPONIBLE",
          "Uno o más artículos del carrito ya no están disponibles",
          { eventos: noDisponibles },
        );
      }

      // (4) D4.2 — reservas vencidas de estos SKU en el depósito web, liberadas
      // ya, sin depender del job.
      const liberadas = await liberarReservasVencidasTx(
        tx,
        { depositoId, skuIds: items.map((i) => i.variante_sku_id) },
        ahora,
      );

      // (5) Paso 3 — una reserva por ítem (Módulo A), todo o nada.
      const reservas: ReservaCongeladaPayload[] = [];
      const vencimientos: number[] = [];
      const itemsPedido = [];
      for (const item of items) {
        const vista = vistas.get(item.variante_sku_id)!;
        try {
          const reserva = await crearReservaTx(
            tx,
            {
              variante_sku_id: item.variante_sku_id,
              deposito_id: depositoId,
              cantidad: item.cantidad,
              origen_reserva: "CHECKOUT_WEB",
              motivo: motivoReservaCheckout(carrito.id),
              ttl_horas: ttlHoras,
            },
            usuarioCanalWebId,
          );
          reservas.push(reserva.evento);
          vencimientos.push(new Date(reserva.fecha_inicio_reserva).getTime() + reserva.ttl_horas * 60 * 60 * 1000);
          itemsPedido.push({
            variante_sku_id: item.variante_sku_id,
            cantidad: item.cantidad,
            precio_unitario: vista.precio_venta_decimal!,
            reserva_id: reserva.reserva_id,
          });
        } catch (error) {
          if (error instanceof ServiceError && error.code === "STOCK_INSUFICIENTE") {
            throw new ServiceError("STOCK_INSUFICIENTE", "No hay stock suficiente para uno o más artículos", {
              items: [
                {
                  item_id: item.id,
                  variante_sku_id: item.variante_sku_id,
                  sku: vista.sku,
                  solicitado: item.cantidad,
                  disponible: vista.disponible,
                },
              ],
            });
          }
          throw error;
        }
      }

      // (6) Paso 4 — PedidoVenta RESERVADO vía Módulo B + extensión PAGO_PENDIENTE.
      const pedido = await crearPedidoVentaReservadoTx(tx, {
        canal: "WEB",
        cliente_id: sesion.clienteId,
        registrado_por_id: usuarioCanalWebId,
        items: itemsPedido,
      });
      const ecommerce = await tx.pedidoVentaEcommerce.create({
        data: { pedido_venta_id: pedido.pedido_venta_id, estado_ecommerce: "PAGO_PENDIENTE" },
        select: { id: true },
      });

      // Ventana de pago = el vencimiento más próximo de las reservas creadas.
      const ttlExpiracion = new Date(Math.min(...vencimientos));
      return {
        respuesta: {
          pedido_venta_id: pedido.pedido_venta_id,
          numero_venta: pedido.numero_venta,
          estado_ecommerce: "PAGO_PENDIENTE",
          total: pedido.total.toNumber(),
          ttl_expiracion: ttlExpiracion.toISOString(),
          checkout_url: null,
          reutilizado: false,
        },
        carritoId: carrito.id,
        pedidoVentaEcommerceId: ecommerce.id,
        reservas,
        liberadas,
        convertidoEn: ahora,
      };
    },
    { timeout: TIMEOUT_TRANSACCION_MS },
  );
}
