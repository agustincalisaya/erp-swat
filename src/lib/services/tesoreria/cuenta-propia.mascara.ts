/**
 * @module cuenta-propia.mascara
 * @description Helper PURO de enmascarado de HU-G5 (`enmascararUltimos4`), spec
 * modulo_G.md §9.7 (G5-3). Vive en un módulo hermano sin `server-only` ni
 * alias `@/` — mismo patrón que `cuenta-por-pagar.calculo.ts` — para poder
 * verificarlo con `node --experimental-strip-types --test` (la capa de
 * servicio, con `server-only`, no es importable desde ese runner).
 *
 * El servicio de dominio (`cuenta-propia.service.ts`) importa y RE-EXPORTA
 * este helper; el punto de verdad de la regla de enmascarado es único.
 */

/** Prefijo fijo de todo valor enmascarado: garantiza que nunca se vea completo. */
export const MASCARA = "****";

/**
 * Enmascara un valor mostrando, como máximo, sus 4 caracteres finales.
 *
 * @param valor - CBU, alias o `null`/`""` (una caja sin datos bancarios).
 * @returns `null` si el valor es `null`/vacío; si no, `"****"` + los últimos
 *          hasta 4 caracteres (un valor de 1..4 caracteres se muestra entero
 *          detrás de la máscara; uno más largo, solo su cola).
 */
export function enmascararUltimos4(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const limpio = valor.trim();
  if (limpio.length === 0) return null;
  return MASCARA + limpio.slice(-4);
}
