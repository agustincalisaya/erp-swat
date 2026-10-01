/**
 * HU-E1 — Reglas puras del carrito (sin Prisma): plan de fusión del carrito de
 * visitante con el de la cuenta (CA7, spec_modulo_E.md §2.1).
 */

export interface ItemCarritoPlano {
  id: string;
  variante_sku_id: string;
  cantidad: number;
  is_active: boolean;
}

export type AccionFusion =
  /** El SKU ya está activo en el carrito de la cuenta: se suman cantidades. */
  | { tipo: "SUMAR"; item_destino_id: string; nueva_cantidad: number; item_origen_id: string }
  /** El SKU estuvo en el carrito de la cuenta pero fue quitado: se reactiva
   * con la cantidad del visitante (`@@unique([carrito_id, variante_sku_id])`
   * impide crear otra fila). */
  | { tipo: "REACTIVAR"; item_destino_id: string; nueva_cantidad: number; item_origen_id: string }
  /** El SKU no existe en el carrito de la cuenta: se crea. */
  | { tipo: "CREAR"; variante_sku_id: string; cantidad: number; item_origen_id: string };

/**
 * Plan de fusión: por cada ítem ACTIVO del visitante, una acción sobre el
 * carrito destino. No valida stock (spec §2.1: la fusión no consulta Módulo A,
 * solo el checkout). Los ítems inactivos del visitante se ignoran.
 */
export function planificarFusion(
  origen: readonly ItemCarritoPlano[],
  destino: readonly ItemCarritoPlano[],
): AccionFusion[] {
  const destinoPorSku = new Map(destino.map((item) => [item.variante_sku_id, item]));
  const acciones: AccionFusion[] = [];

  for (const item of origen) {
    if (!item.is_active) continue;
    const existente = destinoPorSku.get(item.variante_sku_id);
    if (!existente) {
      acciones.push({ tipo: "CREAR", variante_sku_id: item.variante_sku_id, cantidad: item.cantidad, item_origen_id: item.id });
    } else if (existente.is_active) {
      acciones.push({
        tipo: "SUMAR",
        item_destino_id: existente.id,
        nueva_cantidad: existente.cantidad + item.cantidad,
        item_origen_id: item.id,
      });
    } else {
      acciones.push({
        tipo: "REACTIVAR",
        item_destino_id: existente.id,
        nueva_cantidad: item.cantidad,
        item_origen_id: item.id,
      });
    }
  }
  return acciones;
}
