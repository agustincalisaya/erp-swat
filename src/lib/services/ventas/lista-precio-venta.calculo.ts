/**
 * @module lista-precio-venta.calculo
 * @description HU-B9 — reglas PURAS de la Lista de Precios de Venta
 * (spec_modulo_B.md §2.9). Sin `server-only`, sin Prisma ni alias `@/...`:
 * testeable con el runner nativo de Node (mismo patrón que
 * `turno-caja.calculo.ts` / `lista-precios.calculo.ts`).
 */

/**
 * Precio sugerido = costo de reposición × (1 + margen), SIN redondeo comercial
 * (decisión Punto abierto 8: el redondeo a la centena es solo del seed). Se
 * normaliza a 2 decimales —escala de `Decimal(12, 2)`— para no arrastrar
 * artefactos de punto flotante (15600 × 1.35 = 21060.000000000004).
 * `null` si no hay costo de referencia (HU-H8 sin candidatos).
 */
export function calcularPrecioSugerido(costo: number | null, margen: number): number | null {
  if (costo === null) return null;
  return Math.round(costo * (1 + margen) * 100) / 100;
}

export type ResultadoValidacionBajoCosto =
  | { ok: true; confirmado_bajo_costo: boolean }
  | { ok: false; code: "MOTIVO_BAJO_COSTO_REQUERIDO" };

/**
 * Regla "precio por debajo del costo exige motivo" (spec §2.9). Sin costo de
 * referencia (`null`) no aplica. Precio igual al costo NO es "inferior". Un
 * motivo compuesto solo por espacios cuenta como ausente ("motivo no vacío").
 */
export function validarBajoCosto(
  precio_venta: number,
  costo: number | null,
  motivo?: string,
): ResultadoValidacionBajoCosto {
  if (costo === null || precio_venta >= costo) return { ok: true, confirmado_bajo_costo: false };
  if (!motivo || motivo.trim().length === 0) return { ok: false, code: "MOTIVO_BAJO_COSTO_REQUERIDO" };
  return { ok: true, confirmado_bajo_costo: true };
}
