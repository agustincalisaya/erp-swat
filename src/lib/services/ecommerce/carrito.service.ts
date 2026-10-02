/**
 * HU-E1 — Carrito persistente de visitante y de cuenta (spec_modulo_E.md §2.1).
 *
 * - Visitante (CA6): carrito identificado por `carrito_token` (cookie firmada,
 *   sin PII). Cliente Web: un único carrito ACTIVO por cuenta (índice único
 *   parcial, D5), recuperable desde cualquier dispositivo (CA7).
 * - El carrito NO reserva stock: al agregar/editar se valida contra el
 *   disponible del canal web como ayuda de UX; la garantía anti-sobreventa es
 *   la reserva del checkout (`checkout.service.ts`).
 * - Regla N.° 1: quitar un ítem, fusionar o convertir en pedido son SIEMPRE
 *   bajas lógicas (`is_active`, `deleted_at`, `deleted_by`, `deletion_reason`).
 *   `deleted_by` = id de la cuenta, o null si el actor es un visitante anónimo.
 * - Propiedad del recurso: un ítem de otro carrito responde 404 (no 403), igual
 *   que spec E §2.9.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { ServiceError } from "@/lib/errors/service-error";
import type {
  ActualizarCantidadCarritoInput,
  AgregarAlCarritoInput,
} from "@/lib/schemas/ecommerce.schema";
import { generarTokenCarrito } from "@/lib/services/ecommerce/carrito-token";
import { planificarFusion } from "@/lib/services/ecommerce/carrito.reglas";
import { resolverVariantesWeb, type VarianteWeb } from "@/lib/services/ecommerce/catalogo-web.service";
import type { MotivoArticuloNoDisponible } from "@/lib/events/event-types";

/** Quién opera el carrito: una cuenta autenticada o un visitante (token o nada). */
export type ContextoCarrito = { cuentaId: string } | { carritoToken: string | null };

const esCuenta = (ctx: ContextoCarrito): ctx is { cuentaId: string } => "cuentaId" in ctx;
const actorDe = (ctx: ContextoCarrito) => (esCuenta(ctx) ? ctx.cuentaId : null);

export const MOTIVO_ITEM_QUITADO = "QUITADO_POR_CLIENTE";
export const MOTIVO_ITEM_FUSIONADO = "FUSIONADO_EN_CARRITO_DE_CUENTA";
export const MOTIVO_CARRITO_FUSIONADO = "FUSIONADO";

// ──────────────────────────────────────────────────────────────────────────────
// Vista del carrito
// ──────────────────────────────────────────────────────────────────────────────

export interface ItemCarritoVista {
  item_id: string;
  variante_sku_id: string;
  sku: string;
  titulo: string;
  talle: string;
  color: string;
  genero: string;
  modelo: string;
  foto_url: string | null;
  producto_web_id: string | null;
  cantidad: number;
  precio_unitario: number | null;
  subtotal: number | null;
  disponible: number;
  comprable: boolean;
  motivo: MotivoArticuloNoDisponible | null;
  stock_suficiente: boolean;
}

export interface CarritoVista {
  carrito_id: string | null;
  items: ItemCarritoVista[];
  /** Suma de los ítems comprables (los no comprables no suman). */
  total: number;
  cantidad_items: number;
  /** Todos los ítems comprables y con stock suficiente. */
  listo_para_checkout: boolean;
}

const CARRITO_VACIO: CarritoVista = {
  carrito_id: null,
  items: [],
  total: 0,
  cantidad_items: 0,
  listo_para_checkout: false,
};

async function buscarCarritoActivo(
  db: Prisma.TransactionClient,
  ctx: ContextoCarrito,
): Promise<{ id: string } | null> {
  if (esCuenta(ctx)) {
    return db.carritoWeb.findFirst({
      where: { cuenta_cliente_web_id: ctx.cuentaId, is_active: true, deleted_at: null },
      select: { id: true },
    });
  }
  if (!ctx.carritoToken) return null;
  return db.carritoWeb.findFirst({
    where: { carrito_token: ctx.carritoToken, cuenta_cliente_web_id: null, is_active: true, deleted_at: null },
    select: { id: true },
  });
}

function armarVista(
  carritoId: string,
  items: { id: string; variante_sku_id: string; cantidad: number }[],
  vistas: Map<string, VarianteWeb>,
): CarritoVista {
  const filas: ItemCarritoVista[] = [];
  for (const item of items) {
    const v = vistas.get(item.variante_sku_id);
    if (!v) continue;
    const subtotal = v.precio_venta === null ? null : Math.round(v.precio_venta * item.cantidad * 100) / 100;
    filas.push({
      item_id: item.id,
      variante_sku_id: v.variante_sku_id,
      sku: v.sku,
      titulo: v.titulo,
      talle: v.talle,
      color: v.color,
      genero: v.genero,
      modelo: v.modelo,
      foto_url: v.foto_url,
      producto_web_id: v.producto_web_id,
      cantidad: item.cantidad,
      precio_unitario: v.precio_venta,
      subtotal,
      disponible: v.disponible,
      comprable: v.comprable,
      motivo: v.motivo,
      stock_suficiente: v.disponible >= item.cantidad,
    });
  }
  const total = filas.reduce((acc, f) => acc + (f.comprable && f.subtotal !== null ? f.subtotal : 0), 0);
  return {
    carrito_id: carritoId,
    items: filas,
    total: Math.round(total * 100) / 100,
    cantidad_items: filas.reduce((acc, f) => acc + f.cantidad, 0),
    listo_para_checkout: filas.length > 0 && filas.every((f) => f.comprable && f.stock_suficiente),
  };
}

async function vistaDeCarrito(carritoId: string): Promise<CarritoVista> {
  const items = await prisma.carritoWebItem.findMany({
    where: { carrito_id: carritoId, is_active: true, deleted_at: null },
    select: { id: true, variante_sku_id: true, cantidad: true },
    orderBy: { created_at: "asc" },
  });
  const vistas = await resolverVariantesWeb(items.map((i) => i.variante_sku_id));
  return armarVista(carritoId, items, vistas);
}

/** Carrito activo del contexto (sin crearlo): vacío si todavía no hay. */
export async function obtenerCarrito(ctx: ContextoCarrito): Promise<CarritoVista> {
  const carrito = await buscarCarritoActivo(prisma, ctx);
  return carrito ? vistaDeCarrito(carrito.id) : CARRITO_VACIO;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutaciones
// ──────────────────────────────────────────────────────────────────────────────

export interface ResultadoMutacionCarrito {
  carrito: CarritoVista;
  /** Token nuevo a setear en cookie (solo si se creó un carrito de visitante). */
  token_nuevo: string | null;
}

/**
 * Crea el carrito si el contexto no tiene uno activo. Para una cuenta, una
 * carrera entre dos requests choca contra el índice único parcial (P2002) y
 * se resuelve releyendo el carrito ganador.
 */
async function obtenerOCrearCarrito(ctx: ContextoCarrito): Promise<{ id: string; token_nuevo: string | null }> {
  const existente = await buscarCarritoActivo(prisma, ctx);
  if (existente) return { id: existente.id, token_nuevo: null };

  if (esCuenta(ctx)) {
    try {
      const creado = await prisma.carritoWeb.create({
        data: { cuenta_cliente_web_id: ctx.cuentaId },
        select: { id: true },
      });
      return { id: creado.id, token_nuevo: null };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const ganador = await buscarCarritoActivo(prisma, ctx);
        if (ganador) return { id: ganador.id, token_nuevo: null };
      }
      throw error;
    }
  }

  const token = generarTokenCarrito();
  const creado = await prisma.carritoWeb.create({ data: { carrito_token: token }, select: { id: true } });
  return { id: creado.id, token_nuevo: token };
}

function validarAgregable(vista: VarianteWeb | undefined, cantidadTotal: number): VarianteWeb {
  if (!vista) throw new ServiceError("VARIANTE_NO_ENCONTRADA", "El artículo indicado no existe");
  if (!vista.comprable) {
    throw new ServiceError("ARTICULO_NO_DISPONIBLE", "El artículo no está disponible para la compra", {
      items: [{ variante_sku_id: vista.variante_sku_id, sku: vista.sku, motivo: vista.motivo }],
    });
  }
  if (cantidadTotal > vista.disponible) {
    throw new ServiceError("STOCK_INSUFICIENTE", "No hay stock suficiente para la cantidad solicitada", {
      items: [{ variante_sku_id: vista.variante_sku_id, sku: vista.sku, solicitado: cantidadTotal, disponible: vista.disponible }],
    });
  }
  return vista;
}

/**
 * Agrega un artículo (o suma cantidad si ya estaba). Un SKU que se había
 * quitado se REACTIVA (`@@unique([carrito_id, variante_sku_id])`).
 *
 * @throws {ServiceError} VARIANTE_NO_ENCONTRADA (404) | ARTICULO_NO_DISPONIBLE (422) | STOCK_INSUFICIENTE (422)
 */
export async function agregarAlCarrito(
  ctx: ContextoCarrito,
  input: AgregarAlCarritoInput,
): Promise<ResultadoMutacionCarrito> {
  const vistas = await resolverVariantesWeb([input.variante_sku_id]);
  const carritoActual = await buscarCarritoActivo(prisma, ctx);
  const existente = carritoActual
    ? await prisma.carritoWebItem.findUnique({
        where: { carrito_id_variante_sku_id: { carrito_id: carritoActual.id, variante_sku_id: input.variante_sku_id } },
        select: { cantidad: true, is_active: true },
      })
    : null;
  const cantidadPrevia = existente?.is_active ? existente.cantidad : 0;
  validarAgregable(vistas.get(input.variante_sku_id), cantidadPrevia + input.cantidad);

  const carrito = await obtenerOCrearCarrito(ctx);
  await prisma.carritoWebItem.upsert({
    where: { carrito_id_variante_sku_id: { carrito_id: carrito.id, variante_sku_id: input.variante_sku_id } },
    create: { carrito_id: carrito.id, variante_sku_id: input.variante_sku_id, cantidad: input.cantidad },
    update: {
      cantidad: cantidadPrevia + input.cantidad,
      is_active: true,
      deleted_at: null,
      deleted_by: null,
      deletion_reason: null,
    },
  });
  // Tocar el carrito actualiza `updated_at`: insumo del job de abandonados (HU-E5).
  await prisma.carritoWeb.update({ where: { id: carrito.id }, data: { updated_at: new Date() } });

  return { carrito: await vistaDeCarrito(carrito.id), token_nuevo: carrito.token_nuevo };
}

async function buscarItemPropio(ctx: ContextoCarrito, itemId: string) {
  const carrito = await buscarCarritoActivo(prisma, ctx);
  const item = carrito
    ? await prisma.carritoWebItem.findFirst({
        where: { id: itemId, carrito_id: carrito.id, is_active: true, deleted_at: null },
        select: { id: true, carrito_id: true, variante_sku_id: true },
      })
    : null;
  if (!item) throw new ServiceError("ITEM_CARRITO_NO_ENCONTRADO", "El artículo no está en tu carrito");
  return item;
}

/**
 * @throws {ServiceError} ITEM_CARRITO_NO_ENCONTRADO (404) | ARTICULO_NO_DISPONIBLE (422) | STOCK_INSUFICIENTE (422)
 */
export async function actualizarCantidadCarrito(
  ctx: ContextoCarrito,
  itemId: string,
  input: ActualizarCantidadCarritoInput,
): Promise<CarritoVista> {
  const item = await buscarItemPropio(ctx, itemId);
  const vistas = await resolverVariantesWeb([item.variante_sku_id]);
  validarAgregable(vistas.get(item.variante_sku_id), input.cantidad);

  await prisma.carritoWebItem.update({ where: { id: item.id }, data: { cantidad: input.cantidad } });
  await prisma.carritoWeb.update({ where: { id: item.carrito_id }, data: { updated_at: new Date() } });
  return vistaDeCarrito(item.carrito_id);
}

/**
 * Quita un artículo: baja lógica del ítem (nunca `delete`). Siempre permitido,
 * también para un artículo que dejó de ser comprable (es la salida del CA4).
 *
 * @throws {ServiceError} ITEM_CARRITO_NO_ENCONTRADO (404)
 */
export async function quitarDelCarrito(ctx: ContextoCarrito, itemId: string): Promise<CarritoVista> {
  const item = await buscarItemPropio(ctx, itemId);
  const baja = await prisma.carritoWebItem.updateMany({
    where: { id: item.id, is_active: true },
    data: {
      is_active: false,
      deleted_at: new Date(),
      deleted_by: actorDe(ctx),
      deletion_reason: MOTIVO_ITEM_QUITADO,
    },
  });
  if (baja.count === 0) throw new ServiceError("ITEM_CARRITO_NO_ENCONTRADO", "El artículo no está en tu carrito");
  await prisma.carritoWeb.update({ where: { id: item.carrito_id }, data: { updated_at: new Date() } });
  return vistaDeCarrito(item.carrito_id);
}

// ──────────────────────────────────────────────────────────────────────────────
// Fusión al iniciar sesión (CA7)
// ──────────────────────────────────────────────────────────────────────────────

export interface ResultadoFusion {
  carrito_origen_id: string;
  carrito_destino_id: string;
  items_fusionados: number;
}

/**
 * Fusiona el carrito del visitante (token) con el carrito activo de la
 * cuenta, en una sola transacción: suma cantidades de SKU repetidos, reactiva
 * los que la cuenta había quitado y crea el resto (`planificarFusion`). El
 * carrito visitante y sus ítems quedan de baja lógica; `carrito_token = null`.
 * No valida stock (spec §2.1: eso ocurre en el checkout).
 *
 * Idempotente frente a dos logins concurrentes: la baja del carrito visitante
 * es un `updateMany` condicionado (`is_active: true`) que va PRIMERO y toma el
 * lock de la fila; la segunda transacción ve `count === 0` y no hace nada.
 *
 * @returns `null` si no había carrito de visitante activo para ese token.
 */
export async function fusionarCarritoVisitante(
  carritoToken: string,
  cuentaId: string,
): Promise<ResultadoFusion | null> {
  const ahora = new Date();
  const resultado = await prisma.$transaction(async (tx) => {
    const origen = await buscarCarritoActivo(tx, { carritoToken });
    if (!origen) return null;

    const baja = await tx.carritoWeb.updateMany({
      where: { id: origen.id, is_active: true, cuenta_cliente_web_id: null },
      data: {
        is_active: false,
        carrito_token: null,
        deleted_at: ahora,
        deleted_by: cuentaId,
        deletion_reason: MOTIVO_CARRITO_FUSIONADO,
      },
    });
    if (baja.count === 0) return null;

    const destino =
      (await buscarCarritoActivo(tx, { cuentaId })) ??
      (await tx.carritoWeb.create({ data: { cuenta_cliente_web_id: cuentaId }, select: { id: true } }));

    const [itemsOrigen, itemsDestino] = await Promise.all([
      tx.carritoWebItem.findMany({
        where: { carrito_id: origen.id, is_active: true, deleted_at: null },
        select: { id: true, variante_sku_id: true, cantidad: true, is_active: true },
      }),
      tx.carritoWebItem.findMany({
        where: { carrito_id: destino.id },
        select: { id: true, variante_sku_id: true, cantidad: true, is_active: true },
      }),
    ]);

    for (const accion of planificarFusion(itemsOrigen, itemsDestino)) {
      if (accion.tipo === "CREAR") {
        await tx.carritoWebItem.create({
          data: { carrito_id: destino.id, variante_sku_id: accion.variante_sku_id, cantidad: accion.cantidad },
        });
      } else {
        await tx.carritoWebItem.update({
          where: { id: accion.item_destino_id },
          data: {
            cantidad: accion.nueva_cantidad,
            is_active: true,
            deleted_at: null,
            deleted_by: null,
            deletion_reason: null,
          },
        });
      }
    }

    await tx.carritoWebItem.updateMany({
      where: { carrito_id: origen.id, is_active: true },
      data: { is_active: false, deleted_at: ahora, deleted_by: cuentaId, deletion_reason: MOTIVO_ITEM_FUSIONADO },
    });
    await tx.carritoWeb.update({ where: { id: destino.id }, data: { updated_at: ahora } });

    return { carrito_origen_id: origen.id, carrito_destino_id: destino.id, items_fusionados: itemsOrigen.length };
  });

  if (resultado) {
    domainEventBus.emit("ecommerce:carrito_fusionado", { ...resultado, cliente_web_cuenta_id: cuentaId });
  }
  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// HU-E2 (P5) — reconstrucción del carrito tras un pago rechazado
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Vuelve a poner en el carrito ACTIVO de la cuenta los artículos de un pedido
 * cuyo pago se rechazó, para que "reintentar" sea un checkout nuevo (re-valida,
 * re-reserva y re-congela precios). Solo variante + cantidad: nada de reservas
 * ni precios. Si la cuenta ya armó otro carrito, se SUMA a ese (índice único
 * parcial de D5: un solo carrito activo por cuenta); un SKU quitado antes se
 * reactiva. Corre dentro del `tx` del rechazo; no valida stock (lo hace el
 * checkout, mismo criterio que la fusión, spec §2.1).
 */
export async function reconstruirCarritoDesdePedidoTx(
  tx: Prisma.TransactionClient,
  cuentaId: string,
  items: readonly { variante_sku_id: string; cantidad: number }[],
): Promise<{ carrito_id: string }> {
  const carrito =
    (await buscarCarritoActivo(tx, { cuentaId })) ??
    (await tx.carritoWeb.create({ data: { cuenta_cliente_web_id: cuentaId }, select: { id: true } }));

  for (const item of items) {
    const existente = await tx.carritoWebItem.findUnique({
      where: { carrito_id_variante_sku_id: { carrito_id: carrito.id, variante_sku_id: item.variante_sku_id } },
      select: { cantidad: true, is_active: true },
    });
    const cantidadPrevia = existente?.is_active ? existente.cantidad : 0;
    await tx.carritoWebItem.upsert({
      where: { carrito_id_variante_sku_id: { carrito_id: carrito.id, variante_sku_id: item.variante_sku_id } },
      create: { carrito_id: carrito.id, variante_sku_id: item.variante_sku_id, cantidad: item.cantidad },
      update: {
        cantidad: cantidadPrevia + item.cantidad,
        is_active: true,
        deleted_at: null,
        deleted_by: null,
        deletion_reason: null,
      },
    });
  }
  await tx.carritoWeb.update({ where: { id: carrito.id }, data: { updated_at: new Date() } });
  return { carrito_id: carrito.id };
}
