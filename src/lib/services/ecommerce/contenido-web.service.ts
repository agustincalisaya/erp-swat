/**
 * HU-E11 — Contenido comercial del catálogo online (spec_modulo_E.md §2.11;
 * task_relos.md D4, D5, D17–D26).
 *
 * El contenido (título y descripción) se asocia 1:1 al Producto Maestro de
 * Módulo A; talles, colores, géneros y modelos se leen SIEMPRE de sus
 * variantes, nunca se copian acá (criterio 1). Nada de este servicio lee ni
 * escribe `VarianteSKU`, stock, reservas ni Módulo B (criterio 6, D15): el
 * Producto Maestro solo se lee para validar el alta.
 *
 * La baja lógica del contenido NO está acá: es `darDeBajaContenidoWeb()` de
 * HU-E5 (`visibilidad-web.service.ts`), que se reutiliza sin cambios.
 *
 * Eventos post-COMMIT con captura local (D25): un listener que lanza nunca
 * convierte en error una operación ya confirmada. Un no-op no emite.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import type { CrearContenidoWebInput, EditarContenidoWebInput } from "@/lib/schemas/ecommerce.schema";

const ACTIVO = { is_active: true, deleted_at: null } as const;

function contenidoNoEncontrado(): ServiceError {
  return new ServiceError("PRODUCTO_WEB_NO_ENCONTRADO", "El contenido web no existe o fue dado de baja");
}

function contenidoExistente(): ServiceError {
  return new ServiceError(
    "CONTENIDO_WEB_EXISTENTE",
    "El producto maestro ya tiene contenido web (activo o dado de baja); no se crea otro",
  );
}

/**
 * Réplica local del helper post-COMMIT de HU-E5 (D26). El log solo lleva el
 * evento, el registro y el tipo de error: nunca el mensaje.
 */
function emitirPostCommitSeguroE11<K extends keyof DomainEventMap>(
  evento: K,
  payload: DomainEventMap[K],
  registroId: string,
): void {
  try {
    domainEventBus.emit(evento, payload);
  } catch (error) {
    console.error(`[HU-E11] Falló la publicación post-commit de ${String(evento)}:`, {
      registro_id: registroId,
      tipo_error: error instanceof Error ? error.name : "desconocido",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Alta (D4)
// ──────────────────────────────────────────────────────────────────────────────

export interface ResultadoAltaContenidoWeb {
  producto_web_id: string;
  producto_maestro_id: string;
  visibilidad_web: false;
}

/**
 * Una fila por Producto Maestro: si ya existe contenido —activo o dado de
 * baja— responde 409, sin reactivar (D4). Nace oculto: mostrarlo en la tienda
 * es la operación de HU-E5.
 *
 * @throws {ServiceError} PRODUCTO_MAESTRO_NO_ENCONTRADO (404) | CONTENIDO_WEB_EXISTENTE (409)
 */
export async function crearContenidoWeb(
  input: CrearContenidoWebInput,
  actorId: string,
): Promise<ResultadoAltaContenidoWeb> {
  let creado: { id: string };
  try {
    creado = await prisma.$transaction(async (tx) => {
      const producto = await tx.productoMaestro.findFirst({
        where: { id: input.producto_maestro_id, ...ACTIVO },
        select: { id: true },
      });
      if (!producto) {
        throw new ServiceError("PRODUCTO_MAESTRO_NO_ENCONTRADO", "El producto maestro no existe o está inactivo");
      }
      // Sin filtro de baja a propósito (D4): un contenido dado de baja también bloquea el alta.
      const existente = await tx.productoWebContenido.findUnique({
        where: { producto_maestro_id: input.producto_maestro_id },
        select: { id: true },
      });
      if (existente) throw contenidoExistente();
      return tx.productoWebContenido.create({
        data: {
          producto_maestro_id: input.producto_maestro_id,
          titulo_comercial: input.titulo_comercial,
          descripcion: input.descripcion,
          visibilidad_web: false,
        },
        select: { id: true },
      });
    });
  } catch (error) {
    // Dos altas concurrentes: la segunda choca con `producto_maestro_id @unique`.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw contenidoExistente();
    throw error;
  }

  emitirPostCommitSeguroE11(
    "ecommerce:contenido_web_creado",
    {
      producto_web_id: creado.id,
      producto_maestro_id: input.producto_maestro_id,
      titulo_comercial: input.titulo_comercial,
      descripcion: input.descripcion,
      actor_id: actorId,
    },
    creado.id,
  );
  return { producto_web_id: creado.id, producto_maestro_id: input.producto_maestro_id, visibilidad_web: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Edición (D5)
// ──────────────────────────────────────────────────────────────────────────────

export interface ResultadoEdicionContenidoWeb {
  producto_web_id: string;
  titulo_comercial: string;
  descripcion: string;
  visibilidad_web: boolean;
}

/**
 * Solo título y/o descripción. Lock de la fila del contenido activo; pedir los
 * mismos valores es un no-op: 200 con el estado actual, sin UPDATE ni evento
 * (D24).
 *
 * @throws {ServiceError} PRODUCTO_WEB_NO_ENCONTRADO (404) — inexistente o dado de baja
 */
export async function editarContenidoWeb(
  productoWebId: string,
  input: EditarContenidoWebInput,
  actorId: string,
): Promise<ResultadoEdicionContenidoWeb> {
  const resultado = await prisma.$transaction(async (tx) => {
    const bloqueado = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM contenidos_producto_web
      WHERE id = ${productoWebId} AND is_active = true AND deleted_at IS NULL
      FOR UPDATE`;
    if (bloqueado.length === 0) throw contenidoNoEncontrado();
    const actual = await tx.productoWebContenido.findUniqueOrThrow({
      where: { id: productoWebId },
      select: { producto_maestro_id: true, titulo_comercial: true, descripcion: true, visibilidad_web: true },
    });

    const antes: { titulo_comercial?: string; descripcion?: string } = {};
    const despues: { titulo_comercial?: string; descripcion?: string } = {};
    if (input.titulo_comercial !== undefined && input.titulo_comercial !== actual.titulo_comercial) {
      antes.titulo_comercial = actual.titulo_comercial;
      despues.titulo_comercial = input.titulo_comercial;
    }
    if (input.descripcion !== undefined && input.descripcion !== actual.descripcion) {
      antes.descripcion = actual.descripcion;
      despues.descripcion = input.descripcion;
    }
    if (Object.keys(despues).length === 0) return { actual, cambio: null };

    await tx.productoWebContenido.updateMany({ where: { id: productoWebId, ...ACTIVO }, data: despues });
    return { actual: { ...actual, ...despues }, cambio: { antes, despues } };
  });

  if (resultado.cambio) {
    emitirPostCommitSeguroE11(
      "ecommerce:contenido_web_editado",
      {
        producto_web_id: productoWebId,
        producto_maestro_id: resultado.actual.producto_maestro_id,
        antes: resultado.cambio.antes,
        despues: resultado.cambio.despues,
        actor_id: actorId,
      },
      productoWebId,
    );
  }
  return {
    producto_web_id: productoWebId,
    titulo_comercial: resultado.actual.titulo_comercial,
    descripcion: resultado.actual.descripcion,
    visibilidad_web: resultado.actual.visibilidad_web,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Lecturas de administración (solo lectura, D26)
// ──────────────────────────────────────────────────────────────────────────────

export interface ProductoSinContenido {
  producto_maestro_id: string;
  nombre: string;
  categoria: string;
}

/**
 * Productos Maestros activos que todavía no tienen contenido web. Uno con
 * contenido dado de baja tampoco se ofrece: el alta respondería 409 (D4).
 */
export async function listarProductosSinContenido(): Promise<ProductoSinContenido[]> {
  const filas = await prisma.productoMaestro.findMany({
    where: { ...ACTIVO, contenido_web: { is: null } },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
    select: { id: true, nombre: true, categoria: true },
  });
  return filas.map((f) => ({ producto_maestro_id: f.id, nombre: f.nombre, categoria: f.categoria }));
}

export interface FotoWebAdmin {
  foto_id: string;
  url: string;
  es_principal: boolean;
  orden: number;
}

export interface DetalleContenidoWebAdmin {
  descripcion: string;
  fotos: FotoWebAdmin[];
}

/**
 * Descripción y fotos activas (principal primero, luego por `orden`) de los
 * contenidos activos pedidos; complementa `listarContenidoWebAdmin()` de E5.
 */
export async function obtenerDetalleContenidosAdmin(
  productoWebIds: readonly string[],
): Promise<Map<string, DetalleContenidoWebAdmin>> {
  const resultado = new Map<string, DetalleContenidoWebAdmin>();
  if (productoWebIds.length === 0) return resultado;
  const filas = await prisma.productoWebContenido.findMany({
    where: { id: { in: [...productoWebIds] }, ...ACTIVO },
    select: {
      id: true,
      descripcion: true,
      fotos: {
        where: ACTIVO,
        orderBy: [{ es_principal: "desc" }, { orden: "asc" }, { created_at: "asc" }],
        select: { id: true, url: true, es_principal: true, orden: true },
      },
    },
  });
  for (const f of filas) {
    resultado.set(f.id, {
      descripcion: f.descripcion,
      fotos: f.fotos.map((foto) => ({ foto_id: foto.id, url: foto.url, es_principal: foto.es_principal, orden: foto.orden })),
    });
  }
  return resultado;
}
