import type { EstadoOrdenCompra } from "@prisma/client";
import type { TipoComprobanteValor } from "@/lib/schemas/comprobantes-proveedor.schema";

/**
 * Reglas puras de HU-H9 (spec_modulo_H.md §2.7 / §3.6), extraídas del
 * servicio para poder testearlas a nivel unitario (Nivel 1 de la
 * metodología del proyecto) sin tocar Prisma. `comprobante-proveedor.service.ts`
 * es el único consumidor server-side de estas funciones.
 */

/**
 * Estados de `OrdenCompra` que admiten la carga de un comprobante
 * (criterio de aceptación de HU-H9): los únicos dos "iguales o posteriores a
 * `RECIBIDA_COMPLETA`" en la máquina de estados de §3.1. `CANCELADA` queda
 * explícitamente excluida.
 */
export const ESTADOS_OC_ADMITEN_COMPROBANTE: readonly EstadoOrdenCompra[] = [
  "RECIBIDA_COMPLETA",
  "CERRADA",
] as const;

export interface OrdenParaComprobante {
  estado: EstadoOrdenCompra;
  is_active: boolean;
  deleted_at: Date | null;
}

/**
 * Precondición de estado de la OC (spec §2.7, "Comportamiento esperado"). Una
 * OC dada de baja lógica (`is_active = false` / `deleted_at`) nunca admite
 * comprobante, sin importar su `estado`.
 */
export function ordenCompraAdmiteComprobante(orden: OrdenParaComprobante): boolean {
  if (!orden.is_active || orden.deleted_at !== null) return false;
  return ESTADOS_OC_ADMITEN_COMPROBANTE.includes(orden.estado);
}

/**
 * Resolución server-side del `proveedor_id` del comprobante: SIEMPRE se toma
 * de `orden_compra.proveedor_id` en el momento de la carga (spec §2.7 / §2.7.1
 * — mismo patrón de congelamiento que `OrdenCompraItem.precio_unitario`).
 * Nunca se acepta un valor de cliente. Función trivial por diseño: existe
 * para que el punto de resolución sea único, explícito y testeable.
 */
export function resolverProveedorIdDeOrden(orden: { proveedor_id: string }): string {
  return orden.proveedor_id;
}

/**
 * Clave de unicidad compuesta del criterio de aceptación de HU-H9:
 * `numero_comprobante` + `tipo` + `proveedor_id` (espeja el `@@unique` del
 * schema, §2.7.1). Se usa para deduplicar en memoria y para los tests de la
 * validación aplicativa previa a la escritura.
 */
export function construirClaveUnicidadComprobante(datos: {
  numero_comprobante: string;
  tipo: TipoComprobanteValor;
  proveedor_id: string;
}): string {
  return `${datos.proveedor_id}::${datos.tipo}::${datos.numero_comprobante.trim()}`;
}

export type ResultadoAnulacion =
  | { ok: true }
  | { ok: false; code: "COMPROBANTE_NO_ENCONTRADO" | "COMPROBANTE_YA_ANULADO" };

/**
 * Transición de baja lógica de `ComprobanteProveedor` (§3.6): `ACTIVO` →
 * `ANULADO`. `ANULADO` es terminal — no hay vuelta a `ACTIVO` ni edición de
 * campos. `null` de comprobante = no encontrado.
 */
export function evaluarAnulacion(
  comprobante: { is_active: boolean } | null,
): ResultadoAnulacion {
  if (!comprobante) return { ok: false, code: "COMPROBANTE_NO_ENCONTRADO" };
  if (!comprobante.is_active) return { ok: false, code: "COMPROBANTE_YA_ANULADO" };
  return { ok: true };
}
