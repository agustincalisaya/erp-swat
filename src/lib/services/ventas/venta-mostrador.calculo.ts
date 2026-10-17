/**
 * HU-B1 (Módulo B) — Funciones puras de cálculo de venta de mostrador
 * (spec_modulo_B.md §2.1). Separadas de `venta-mostrador.service.ts` para
 * poder testearlas unitariamente sin tocar Prisma/DB — mismo criterio que
 * `turno-caja.calculo.ts` (HU-B2).
 */

export interface ItemParaCalculo {
  precio_unitario: number;
  cantidad: number;
  descuento_porcentual?: number | null;
}

/**
 * Total de un ítem con su descuento porcentual aplicado, redondeado a 2
 * decimales (evita arrastre de error de punto flotante en los `Decimal` de
 * Postgres). Mismo cálculo que el `.refine()` de `RegistrarVentaMostradorSchema`.
 */
export function calcularTotalItem(item: ItemParaCalculo): number {
  const descuento = item.descuento_porcentual ?? 0;
  const bruto = item.precio_unitario * item.cantidad;
  const total = bruto * (1 - descuento / 100);
  return Math.round(total * 100) / 100;
}

/** Suma de `calcularTotalItem()` sobre todos los ítems de la venta. */
export function calcularTotalVenta(items: ItemParaCalculo[]): number {
  const total = items.reduce((acc, item) => acc + calcularTotalItem(item), 0);
  return Math.round(total * 100) / 100;
}

/**
 * `true` si el descuento de un ítem excede el margen habilitado (HU-B4 §2.4,
 * `MARGEN_DESCUENTO_CAJERO_POS`) y por lo tanto ese `PedidoVentaItem` debe
 * crearse con `requiere_autorizacion: true`.
 */
export function itemSuperaMargenDescuento(
  descuentoPorcentual: number | null | undefined,
  margen: number,
): boolean {
  return (descuentoPorcentual ?? 0) > margen;
}

/**
 * Suma de los `medios_pago.importe` recibidos — mismo cálculo que el lado
 * derecho del `.refine()` de `RegistrarVentaMostradorSchema`.
 */
export function sumarMediosPago(mediosPago: { importe: number }[]): number {
  const total = mediosPago.reduce((acc, m) => acc + m.importe, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Tolerancia de centavos entre el total de ítems (con descuentos aplicados)
 * y la suma de medios de pago — mismo valor que el `.refine()` del schema
 * (`< 0.01`). Expuesto para que el service pueda revalidar server-side sin
 * duplicar el literal mágico.
 */
export const TOLERANCIA_CENTAVOS = 0.01;
