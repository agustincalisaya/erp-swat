/**
 * HU-E5 — Visibilidad web independiente del inventario físico
 * (spec_modulo_E.md §2.5; docs/tasks/task_relos.md D1–D3, D6–D8, D17).
 *
 * Dos operaciones separadas (D1):
 * - `cambiarVisibilidadWeb`: ocultar/mostrar en la tienda. UPDATE reversible
 *   de `visibilidad_web`, motivo opcional; no toca `is_active` ni `deleted_*`.
 * - `darDeBajaContenidoWeb`: baja lógica del contenido (criterio 3), motivo
 *   obligatorio, fuerza `visibilidad_web = false`. Sin reactivación en E5.
 *   HU-E11 debe reutilizar esta función para la baja del contenido (D17).
 *
 * Criterios 1 y 2: nada de esto lee ni escribe `VarianteSKU`,
 * `ProductoMaestro` ni stock de Módulo A — la bandera es propia de Módulo E.
 *
 * Los eventos se emiten DESPUÉS del COMMIT con una captura local: un listener
 * que lanza nunca convierte en error una operación ya confirmada.
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import type { BajaContenidoWebInput, CambiarVisibilidadWebInput } from "@/lib/schemas/ecommerce.schema";

const CONTENIDO_ACTIVO = { is_active: true, deleted_at: null } as const;

function noEncontrado(): ServiceError {
  return new ServiceError("PRODUCTO_WEB_NO_ENCONTRADO", "El contenido web no existe o fue dado de baja");
}

/**
 * Publica un evento post-COMMIT sin propagar un throw síncrono de un
 * listener (equivalente local al helper privado de HU-E2). El log solo lleva
 * el nombre del evento, el contenido y el tipo de error: nunca el mensaje.
 */
function emitirPostCommitSeguroE5<K extends keyof DomainEventMap>(
  evento: K,
  payload: DomainEventMap[K],
  productoWebId: string,
): void {
  try {
    domainEventBus.emit(evento, payload);
  } catch (error) {
    console.error(`[HU-E5] Falló la publicación post-commit de ${String(evento)}:`, {
      producto_web_id: productoWebId,
      tipo_error: error instanceof Error ? error.name : "desconocido",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Ocultar / mostrar en la tienda (spec §2.5)
// ──────────────────────────────────────────────────────────────────────────────

export interface ResultadoVisibilidadWeb {
  producto_web_id: string;
  visibilidad_web: boolean;
}

/**
 * Pedir el valor que ya tiene es un no-op: 200 con el estado actual, sin
 * UPDATE, sin evento y sin notificaciones (D2). El UPDATE es condicional al
 * valor anterior, así dos pedidos concurrentes iguales emiten un solo evento.
 *
 * @throws {ServiceError} PRODUCTO_WEB_NO_ENCONTRADO (404) — inexistente o dado de baja (D3)
 */
export async function cambiarVisibilidadWeb(
  productoWebId: string,
  input: CambiarVisibilidadWebInput,
  actorId: string,
): Promise<ResultadoVisibilidadWeb> {
  const nuevo = input.visibilidad_web;
  const cambio = await prisma.$transaction(async (tx) => {
    const contenido = await tx.productoWebContenido.findFirst({
      where: { id: productoWebId, ...CONTENIDO_ACTIVO },
      select: { id: true, producto_maestro_id: true, visibilidad_web: true },
    });
    if (!contenido) throw noEncontrado();
    if (contenido.visibilidad_web === nuevo) return null;

    const actualizado = await tx.productoWebContenido.updateMany({
      where: { id: productoWebId, ...CONTENIDO_ACTIVO, visibilidad_web: !nuevo },
      data: { visibilidad_web: nuevo },
    });
    if (actualizado.count === 0) {
      // Otra operación lo cambió (o lo dio de baja) entre la lectura y el UPDATE.
      const actual = await tx.productoWebContenido.findFirst({
        where: { id: productoWebId, ...CONTENIDO_ACTIVO },
        select: { id: true },
      });
      if (!actual) throw noEncontrado();
      return null;
    }
    return { producto_maestro_id: contenido.producto_maestro_id };
  });

  if (cambio) {
    emitirPostCommitSeguroE5(
      "ecommerce:visibilidad_web_cambiada",
      {
        producto_web_id: productoWebId,
        producto_maestro_id: cambio.producto_maestro_id,
        visibilidad_anterior: !nuevo,
        visibilidad_nueva: nuevo,
        motivo: input.motivo ?? null,
        actor_id: actorId,
      },
      productoWebId,
    );
    if (!nuevo) await notificarCarritosAfectados(productoWebId, cambio.producto_maestro_id);
  }
  return { producto_web_id: productoWebId, visibilidad_web: nuevo };
}

// ──────────────────────────────────────────────────────────────────────────────
// Baja lógica del contenido web (criterio 3, D1)
// ──────────────────────────────────────────────────────────────────────────────

export interface ResultadoBajaContenidoWeb {
  producto_web_id: string;
  is_active: false;
  deleted_at: Date;
}

/**
 * Baja lógica (nunca DELETE): `is_active = false`, `deleted_at`, `deleted_by`,
 * `deletion_reason` y `visibilidad_web = false`. Una segunda baja da 404 (D3).
 * Solo avisa a los carritos si el contenido estaba visible: si ya estaba
 * oculto, el aviso salió al ocultarlo (task_relos.md §3.3, "cuando deja de
 * ser visible").
 *
 * @throws {ServiceError} PRODUCTO_WEB_NO_ENCONTRADO (404)
 */
export async function darDeBajaContenidoWeb(
  productoWebId: string,
  input: BajaContenidoWebInput,
  actorId: string,
): Promise<ResultadoBajaContenidoWeb> {
  const ahora = new Date();
  const baja = await prisma.$transaction(async (tx) => {
    const contenido = await tx.productoWebContenido.findFirst({
      where: { id: productoWebId, ...CONTENIDO_ACTIVO },
      select: { producto_maestro_id: true, visibilidad_web: true },
    });
    if (!contenido) throw noEncontrado();

    const actualizado = await tx.productoWebContenido.updateMany({
      where: { id: productoWebId, ...CONTENIDO_ACTIVO },
      data: {
        is_active: false,
        deleted_at: ahora,
        deleted_by: actorId,
        deletion_reason: input.deletion_reason,
        visibilidad_web: false,
      },
    });
    if (actualizado.count === 0) throw noEncontrado();
    return contenido;
  });

  emitirPostCommitSeguroE5(
    "ecommerce:contenido_web_baja",
    {
      producto_web_id: productoWebId,
      producto_maestro_id: baja.producto_maestro_id,
      deletion_reason: input.deletion_reason,
      actor_id: actorId,
    },
    productoWebId,
  );
  if (baja.visibilidad_web) await notificarCarritosAfectados(productoWebId, baja.producto_maestro_id);
  return { producto_web_id: productoWebId, is_active: false, deleted_at: ahora };
}

// ──────────────────────────────────────────────────────────────────────────────
// Aviso proactivo a carritos afectados (task §3.3, contrato compartido con E1)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Emite `ecommerce:carrito_articulo_no_disponible` (origen VISIBILIDAD_WEB)
 * por cada ítem activo de un carrito activo cuya variante es del Producto
 * Maestro del contenido. El listener de F3 notifica al dueño (clave de
 * idempotencia `carrito_item_id`, D7) y descarta los visitantes (D8). La
 * operación ya está confirmada: una falla acá se loguea y no se propaga.
 */
async function notificarCarritosAfectados(productoWebId: string, productoMaestroId: string): Promise<void> {
  let items: {
    id: string;
    carrito_id: string;
    variante_sku_id: string;
    variante_sku: { sku: string };
    carrito: { cuenta_cliente_web_id: string | null };
  }[];
  try {
    items = await prisma.carritoWebItem.findMany({
      where: {
        is_active: true,
        deleted_at: null,
        carrito: { is_active: true, deleted_at: null },
        variante_sku: { producto_maestro_id: productoMaestroId },
      },
      select: {
        id: true,
        carrito_id: true,
        variante_sku_id: true,
        variante_sku: { select: { sku: true } },
        carrito: { select: { cuenta_cliente_web_id: true } },
      },
      orderBy: { created_at: "asc" },
    });
  } catch (error) {
    console.error("[HU-E5] Falló la búsqueda de carritos afectados; no se avisó a los clientes:", {
      producto_web_id: productoWebId,
      tipo_error: error instanceof Error ? error.name : "desconocido",
    });
    return;
  }

  for (const item of items) {
    emitirPostCommitSeguroE5(
      "ecommerce:carrito_articulo_no_disponible",
      {
        carrito_id: item.carrito_id,
        carrito_item_id: item.id,
        variante_sku_id: item.variante_sku_id,
        sku: item.variante_sku.sku,
        motivo: "NO_VISIBLE_WEB",
        cliente_web_cuenta_id: item.carrito.cuenta_cliente_web_id,
        origen: "VISIBILIDAD_WEB",
      },
      productoWebId,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Listado de backoffice (D9: lectura desde el Server Component, sin GET nuevo)
// ──────────────────────────────────────────────────────────────────────────────

export interface ContenidoWebAdminFila {
  producto_web_id: string;
  titulo_comercial: string;
  producto_maestro_id: string;
  producto_nombre: string;
  /** Estado del Producto Maestro en Módulo A (informativo, criterio 2). */
  producto_activo: boolean;
  visibilidad_web: boolean;
  fotos_activas: number;
}

export interface ContenidoWebAdminPagina {
  items: ContenidoWebAdminFila[];
  total: number;
  page: number;
  page_size: number;
}

export const PAGE_SIZE_CONTENIDO_WEB_ADMIN = 20;

/** Contenidos activos ordenados por título, con paginación simple. */
export async function listarContenidoWebAdmin(
  opciones: { page?: number; page_size?: number } = {},
): Promise<ContenidoWebAdminPagina> {
  const page = Math.max(1, Math.trunc(opciones.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(opciones.page_size ?? PAGE_SIZE_CONTENIDO_WEB_ADMIN)));
  const [total, filas] = await Promise.all([
    prisma.productoWebContenido.count({ where: CONTENIDO_ACTIVO }),
    prisma.productoWebContenido.findMany({
      where: CONTENIDO_ACTIVO,
      orderBy: [{ titulo_comercial: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        titulo_comercial: true,
        visibilidad_web: true,
        producto_maestro: { select: { id: true, nombre: true, is_active: true, deleted_at: true } },
        _count: { select: { fotos: { where: { is_active: true, deleted_at: null } } } },
      },
    }),
  ]);
  return {
    items: filas.map((f) => ({
      producto_web_id: f.id,
      titulo_comercial: f.titulo_comercial,
      producto_maestro_id: f.producto_maestro.id,
      producto_nombre: f.producto_maestro.nombre,
      producto_activo: f.producto_maestro.is_active && f.producto_maestro.deleted_at === null,
      visibilidad_web: f.visibilidad_web,
      fotos_activas: f._count.fotos,
    })),
    total,
    page,
    page_size: pageSize,
  };
}
