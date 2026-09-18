/**
 * HU-H2 (Módulo H) — Constantes de la publicación de listas de precios de
 * proveedor (`propose.md`, decisión de diseño 1). Ningún documento fuente
 * (`Documento Alcance Funcional Tecnico SWAT.md` §2.2/§3.4, `spec.md`,
 * `design_HU-H2_pieza1_FINAL.md`) define el valor numérico del umbral: el
 * Alcance solo lo describe como "umbral parametrizado por Dirección", sin
 * cuantificarlo. Se toma acá una decisión de ingeniería razonable para no
 * bloquear el desarrollo, documentada explícitamente — mismo criterio ya
 * aplicado en `evaluacion.constants.ts` (HU-H5) para `UMBRAL_MINIMO_HOMOLOGACION`.
 *
 * Constante hardcodeada en código, no entidad de configuración en base de
 * datos (`propose.md`, decisión 1): no existe hoy una entidad de
 * configuración global en Módulo D para este parámetro.
 *
 * ⚠️ Este valor no está validado todavía por el equipo/PO.
 */

/**
 * DECISIÓN PENDIENTE DE VALIDAR: umbral de variación porcentual de precio
 * que dispara `requiere_aprobacion = true` (bloqueo de publicación hasta que
 * un Supervisor de Compras apruebe la versión, `propose.md` — sección
 * "Cálculo de variación porcentual y evento crítico"). Toda variación
 * porcentual máxima (`variacion_porcentual_maxima`) estrictamente mayor a
 * este valor supera el umbral crítico.
 */
export const UMBRAL_VARIACION_CRITICA_PORCENTUAL = 20;
