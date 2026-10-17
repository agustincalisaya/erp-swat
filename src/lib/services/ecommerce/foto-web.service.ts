/**
 * HU-E11 — Fotos del contenido web (spec_modulo_E.md §2.11; task_relos.md
 * D2, D6–D8, D21–D25, D29).
 *
 * Invariantes, garantizadas por servicio (no hay índice parcial en la base):
 * - Como máximo N fotos ACTIVAS por contenido (N de `ConfiguracionSistema`).
 * - Como máximo UNA principal entre las activas; si hay activas, hay principal.
 * Toda operación toma `SELECT … FOR UPDATE` sobre la fila del contenido
 * activo: serializa subidas concurrentes (el conteo contra N no se pasa) y los
 * cambios de principal. Sin DELETE: la baja es lógica y el archivo físico no
 * se borra (D7, D29). Nada toca inventario, POS ni Módulo B (D15).
 */
import "server-only";

import { prisma } from "@/lib/db/prisma";
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";
import { SubirFotoProductoSchema } from "@/lib/schemas/ecommerce.schema";
import type { AlmacenamientoImagenesGateway } from "@/lib/services/ecommerce/almacenamiento-imagenes.gateway";
import { obtenerAlmacenamientoImagenes } from "@/lib/services/ecommerce/almacenamiento-imagenes.local.adapter";
import { MENSAJE_ERROR_IMAGEN, validarImagen } from "@/lib/services/ecommerce/validacion-imagen";
import {
  obtenerFotoFormatosPermitidos,
  obtenerFotosMaxPorProducto,
  obtenerFotoTamanoMaxBytes,
} from "@/lib/services/sistema/configuracion.service";
import type { Prisma } from "@prisma/client";

const ACTIVO = { is_active: true, deleted_at: null } as const;

function contenidoNoEncontrado(): ServiceError {
  return new ServiceError("PRODUCTO_WEB_NO_ENCONTRADO", "El contenido web no existe o fue dado de baja");
}

function fotoNoEncontrada(): ServiceError {
  return new ServiceError("FOTO_WEB_NO_ENCONTRADA", "La foto no existe, no pertenece a este contenido o ya fue dada de baja");
}

function limiteAlcanzado(maximo: number): ServiceError {
  return new ServiceError("LIMITE_FOTOS_ALCANZADO", `El contenido ya tiene el máximo de ${maximo} fotos activas`);
}

/** Réplica local del helper post-COMMIT de HU-E5 (D26). */
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

/** Lock de la fila del contenido ACTIVO; 404 si no existe o fue dado de baja. */
async function bloquearContenidoActivo(tx: Prisma.TransactionClient, productoWebId: string): Promise<void> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM contenidos_producto_web
    WHERE id = ${productoWebId} AND is_active = true AND deleted_at IS NULL
    FOR UPDATE`;
  if (filas.length === 0) throw contenidoNoEncontrado();
}

export interface FotoWebResultado {
  foto_id: string;
  producto_web_id: string;
  url: string;
  es_principal: boolean;
  orden: number;
  is_active: boolean;
  deleted_at: Date | null;
}

const selectFoto = {
  id: true,
  producto_web_contenido_id: true,
  url: true,
  es_principal: true,
  orden: true,
  is_active: true,
  deleted_at: true,
} satisfies Prisma.ProductoWebFotoSelect;

function aResultado(f: Prisma.ProductoWebFotoGetPayload<{ select: typeof selectFoto }>): FotoWebResultado {
  return {
    foto_id: f.id,
    producto_web_id: f.producto_web_contenido_id,
    url: f.url,
    es_principal: f.es_principal,
    orden: f.orden,
    is_active: f.is_active,
    deleted_at: f.deleted_at,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Subida (D2, D6, D8)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Orden: contenido activo → configuración → validación por firma de bytes y
 * tamaño real → pre-chequeo del cupo (evita guardar un archivo que se va a
 * rechazar) → Gateway → transacción con lock (conteo contra N, `orden` =
 * máximo activo + 1, principal) → evento post-COMMIT.
 *
 * La primera foto activa queda principal; `esPrincipal = true` desmarca la
 * anterior en la misma transacción. Si la transacción falla después de
 * guardar, el archivo queda huérfano: se loguea (solo el nombre generado) y
 * no se borra (D29).
 *
 * @throws {ServiceError} PRODUCTO_WEB_NO_ENCONTRADO | ARCHIVO_VACIO | ARCHIVO_DEMASIADO_GRANDE |
 *   FORMATO_IMAGEN_NO_ADMITIDO | LIMITE_FOTOS_ALCANZADO | CONFIGURACION_* | ALMACENAMIENTO_NO_CONFIGURADO
 */
export async function subirFotoProducto(
  productoWebId: string,
  archivo: Uint8Array,
  esPrincipal: boolean,
  actorId: string,
  almacenamiento: AlmacenamientoImagenesGateway = obtenerAlmacenamientoImagenes(),
): Promise<FotoWebResultado> {
  const contenido = await prisma.productoWebContenido.findFirst({
    where: { id: productoWebId, ...ACTIVO },
    select: { id: true },
  });
  if (!contenido) throw contenidoNoEncontrado();

  const [maximo, tamanoMaxBytes, formatosPermitidos] = await Promise.all([
    obtenerFotosMaxPorProducto(),
    obtenerFotoTamanoMaxBytes(),
    obtenerFotoFormatosPermitidos(),
  ]);

  const validacion = validarImagen({ buffer: archivo, formatosPermitidos, tamanoMaxBytes });
  if (!validacion.ok) throw new ServiceError(validacion.error, MENSAJE_ERROR_IMAGEN[validacion.error]);

  // Pre-chequeo NO vinculante (la garantía es el conteo bajo lock de abajo).
  const activas = await prisma.productoWebFoto.count({ where: { producto_web_contenido_id: productoWebId, ...ACTIVO } });
  if (activas >= maximo) throw limiteAlcanzado(maximo);

  const guardada = await almacenamiento.guardarImagen({ contenido: archivo, formato: validacion.formato });
  // Contrato de la spec §2.11 sobre el resultado ya resuelto (D19).
  const resuelta = SubirFotoProductoSchema.parse({ url: guardada.url, es_principal: esPrincipal });

  let creada: { foto: FotoWebResultado; principalAnteriorId: string | null };
  try {
    creada = await prisma.$transaction(async (tx) => {
      await bloquearContenidoActivo(tx, productoWebId);
      const delContenido = { producto_web_contenido_id: productoWebId, ...ACTIVO };
      const conteo = await tx.productoWebFoto.count({ where: delContenido });
      if (conteo >= maximo) throw limiteAlcanzado(maximo);

      const { _max } = await tx.productoWebFoto.aggregate({ where: delContenido, _max: { orden: true } });
      const principalActual = await tx.productoWebFoto.findFirst({
        where: { ...delContenido, es_principal: true },
        select: { id: true },
      });
      const quedaPrincipal = resuelta.es_principal || !principalActual;
      let principalAnteriorId: string | null = null;
      if (resuelta.es_principal && principalActual) {
        await tx.productoWebFoto.updateMany({ where: { ...delContenido, es_principal: true }, data: { es_principal: false } });
        principalAnteriorId = principalActual.id;
      }
      const foto = await tx.productoWebFoto.create({
        data: {
          producto_web_contenido_id: productoWebId,
          url: resuelta.url,
          es_principal: quedaPrincipal,
          orden: (_max.orden ?? -1) + 1,
        },
        select: selectFoto,
      });
      return { foto: aResultado(foto), principalAnteriorId };
    });
  } catch (error) {
    console.error("[HU-E11] Archivo de foto huérfano: se guardó pero la transacción falló (no se borra, D29):", {
      producto_web_id: productoWebId,
      archivo: guardada.nombre,
      tipo_error: error instanceof ServiceError ? error.code : error instanceof Error ? error.name : "desconocido",
    });
    throw error;
  }

  emitirPostCommitSeguroE11(
    "ecommerce:foto_web_subida",
    {
      foto_id: creada.foto.foto_id,
      producto_web_id: productoWebId,
      url: creada.foto.url,
      formato: validacion.formato,
      tamano_bytes: archivo.length,
      es_principal: creada.foto.es_principal,
      orden: creada.foto.orden,
      principal_anterior_id: creada.principalAnteriorId,
      actor_id: actorId,
    },
    creada.foto.foto_id,
  );
  return creada.foto;
}

// ──────────────────────────────────────────────────────────────────────────────
// Marcar como principal (D6, D7)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Desmarca la principal anterior en la misma transacción. Si ya era la
 * principal: no-op, 200 sin UPDATE ni evento.
 *
 * @throws {ServiceError} PRODUCTO_WEB_NO_ENCONTRADO | FOTO_WEB_NO_ENCONTRADA (404)
 */
export async function marcarFotoPrincipal(
  productoWebId: string,
  fotoId: string,
  actorId: string,
): Promise<FotoWebResultado> {
  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearContenidoActivo(tx, productoWebId);
    const delContenido = { producto_web_contenido_id: productoWebId, ...ACTIVO };
    const foto = await tx.productoWebFoto.findFirst({ where: { id: fotoId, ...delContenido }, select: selectFoto });
    if (!foto) throw fotoNoEncontrada();
    if (foto.es_principal) return { foto: aResultado(foto), cambio: null };

    const anterior = await tx.productoWebFoto.findFirst({
      where: { ...delContenido, es_principal: true },
      select: { id: true },
    });
    await tx.productoWebFoto.updateMany({
      where: { ...delContenido, es_principal: true, id: { not: fotoId } },
      data: { es_principal: false },
    });
    const actualizada = await tx.productoWebFoto.update({ where: { id: fotoId }, data: { es_principal: true }, select: selectFoto });
    return { foto: aResultado(actualizada), cambio: { principalAnteriorId: anterior?.id ?? null } };
  });

  if (resultado.cambio) {
    emitirPostCommitSeguroE11(
      "ecommerce:foto_web_principal_cambiada",
      {
        foto_id: fotoId,
        producto_web_id: productoWebId,
        principal_anterior_id: resultado.cambio.principalAnteriorId,
        actor_id: actorId,
      },
      fotoId,
    );
  }
  return resultado.foto;
}

// ──────────────────────────────────────────────────────────────────────────────
// Baja lógica (D6, D7, D29)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `is_active = false`, `deleted_at`, `deleted_by` (actor), `deletion_reason`.
 * Si era la principal y quedan activas, la de menor `orden` pasa a principal
 * en la misma transacción. El archivo físico no se borra. No avisa a carritos
 * aunque el contenido deje de ser publicable (D24).
 *
 * @throws {ServiceError} PRODUCTO_WEB_NO_ENCONTRADO | FOTO_WEB_NO_ENCONTRADA (404)
 */
export async function darDeBajaFoto(
  productoWebId: string,
  fotoId: string,
  deletionReason: string,
  actorId: string,
): Promise<FotoWebResultado> {
  const ahora = new Date();
  const resultado = await prisma.$transaction(async (tx) => {
    await bloquearContenidoActivo(tx, productoWebId);
    const delContenido = { producto_web_contenido_id: productoWebId, ...ACTIVO };
    const foto = await tx.productoWebFoto.findFirst({ where: { id: fotoId, ...delContenido }, select: selectFoto });
    if (!foto) throw fotoNoEncontrada();

    const baja = await tx.productoWebFoto.updateMany({
      where: { id: fotoId, ...ACTIVO },
      data: { is_active: false, deleted_at: ahora, deleted_by: actorId, deletion_reason: deletionReason },
    });
    if (baja.count === 0) throw fotoNoEncontrada();

    let promovidaId: string | null = null;
    if (foto.es_principal) {
      const siguiente = await tx.productoWebFoto.findFirst({
        where: delContenido,
        orderBy: [{ orden: "asc" }, { created_at: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (siguiente) {
        await tx.productoWebFoto.update({ where: { id: siguiente.id }, data: { es_principal: true } });
        promovidaId = siguiente.id;
      }
    }
    const final = await tx.productoWebFoto.findUniqueOrThrow({ where: { id: fotoId }, select: selectFoto });
    return { foto: aResultado(final), eraPrincipal: foto.es_principal, promovidaId };
  });

  emitirPostCommitSeguroE11(
    "ecommerce:foto_web_baja",
    {
      foto_id: fotoId,
      producto_web_id: productoWebId,
      deletion_reason: deletionReason,
      era_principal: resultado.eraPrincipal,
      principal_promovida_id: resultado.promovidaId,
      actor_id: actorId,
    },
    fotoId,
  );
  return resultado.foto;
}
