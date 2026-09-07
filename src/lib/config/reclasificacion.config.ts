/**
 * HU-A9 — Umbral de doble validación para reclasificaciones de unidades
 * DEVUELTO (spec_modulo_A.md §3.8).
 *
 * Un ajuste/reclasificación cuya `cantidad` supera este umbral no se aplica
 * de forma directa: queda `PENDIENTE_APROBACION` en `ReclasificacionSolicitud`
 * hasta que un Administrador la apruebe o rechace. Bajo o igual al umbral, la
 * operación persiste directo.
 *
 * Decisión de diseño (proposal HU-A9): constante exportada, precedente
 * `FACTOR_LEAD_TIME` de `stock.service.ts`. No existe tabla de parámetros en
 * el schema; el valor por defecto del Backlog es 5 unidades. Ajustar la
 * constante NO requiere re-migrar.
 */
export const UMBRAL_BAJA_MERMA_UNIDADES = 5;

/**
 * Indica si una cantidad de unidades reclasificadas supera el umbral de
 * doble validación (spec §3.8): sobre el umbral se requiere aprobación de
 * Administrador, bajo o igual se aplica directo.
 */
export function superaUmbral(cantidad: number): boolean {
  return cantidad > UMBRAL_BAJA_MERMA_UNIDADES;
}