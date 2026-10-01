/**
 * HU-E1 — Predicado único de "comprable" (docs/tasks/HU-E1.md §2.5, D6).
 *
 * Lo usan el catálogo, el carrito y el checkout: lo que no se muestra como
 * comprable tampoco se puede confirmar. Función pura (sin Prisma ni
 * `server-only`) para poder testearla con `node --test`.
 *
 * El stock NO es parte de este predicado: stock insuficiente usa otro código
 * (`STOCK_INSUFICIENTE`) y no notifica (D6).
 */
import type { MotivoArticuloNoDisponible } from "@/lib/events/event-types";

export interface EstadoActivo {
  is_active: boolean;
  deleted_at: Date | null;
}

export interface SnapshotComprabilidad {
  variante: EstadoActivo;
  producto: EstadoActivo;
  /** `null` = el Producto Maestro no tiene contenido web. */
  contenido:
    | (EstadoActivo & {
        visibilidad_web: boolean;
        descripcion: string;
        fotos_activas: number;
      })
    | null;
  /** `null` = sin precio de venta vigente (HU-B9). */
  precio_venta: number | null;
}

export type ResultadoComprabilidad =
  | { comprable: true }
  | { comprable: false; motivo: MotivoArticuloNoDisponible };

const activo = (e: EstadoActivo) => e.is_active && e.deleted_at === null;

/**
 * Evalúa en orden fijo (se informa el PRIMER motivo que aplica):
 * SKU_INACTIVO → PRODUCTO_INACTIVO → NO_VISIBLE_WEB → NO_PUBLICABLE →
 * SIN_PRECIO_VIGENTE.
 */
export function evaluarComprabilidad(s: SnapshotComprabilidad): ResultadoComprabilidad {
  if (!activo(s.variante)) return { comprable: false, motivo: "SKU_INACTIVO" };
  if (!activo(s.producto)) return { comprable: false, motivo: "PRODUCTO_INACTIVO" };
  if (!s.contenido || !activo(s.contenido) || !s.contenido.visibilidad_web) {
    return { comprable: false, motivo: "NO_VISIBLE_WEB" };
  }
  // spec E §2.11: solo se publica con al menos una foto y una descripción.
  if (s.contenido.fotos_activas < 1 || s.contenido.descripcion.trim() === "") {
    return { comprable: false, motivo: "NO_PUBLICABLE" };
  }
  if (s.precio_venta === null) return { comprable: false, motivo: "SIN_PRECIO_VIGENTE" };
  return { comprable: true };
}

/** Etiqueta para la UI del aviso por ítem (CA4). */
export const ETIQUETA_MOTIVO: Record<MotivoArticuloNoDisponible, string> = {
  SKU_INACTIVO: "Este artículo fue discontinuado",
  PRODUCTO_INACTIVO: "Este producto ya no se comercializa",
  NO_VISIBLE_WEB: "Este artículo no está disponible en la tienda online",
  NO_PUBLICABLE: "Este artículo no está publicado en la tienda online",
  SIN_PRECIO_VIGENTE: "Este artículo no tiene un precio vigente",
};
