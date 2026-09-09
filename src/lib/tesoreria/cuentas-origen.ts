/**
 * @module cuentas-origen
 * @description HU-G10 — catálogo PLACEHOLDER de "cuentas de origen" del pago de
 * una Cuenta por Pagar (de dónde sale la plata: banco, caja chica, etc.).
 *
 * NO existe todavía una entidad `CuentaBancaria` / `CajaChica` en el modelo de
 * datos, así que este catálogo es una lista fija en código. `CuentaPorPagar.
 * cuenta_origen_id` guarda uno de estos `id` como referencia LIBRE (sin FK).
 *
 * Sin `import "server-only"`: lo consume tanto el schema Zod de servidor
 * (`cuentas-por-pagar.schema.ts`) como, a futuro, el formulario de pago del
 * cliente. Mantener este módulo libre de dependencias de servidor.
 *
 * TODO(HU futura): reemplazar por una entidad real y migrar
 * `cuenta_origen_id` a una FK.
 */

export interface CuentaOrigen {
  readonly id: string;
  readonly label: string;
}

export const CUENTAS_ORIGEN = [
  // TODO(HU futura): reemplazar por entidad CuentaBancaria/CajaChica real
  { id: "banco-nacion-cc-principal", label: "Banco Nación — Cuenta Corriente Principal" },
  // TODO(HU futura): reemplazar por entidad CuentaBancaria/CajaChica real
  { id: "banco-galicia-cc-operativa", label: "Banco Galicia — Cuenta Corriente Operativa" },
  // TODO(HU futura): reemplazar por entidad CuentaBancaria/CajaChica real
  { id: "caja-chica-central", label: "Caja Chica — Central" },
] as const satisfies readonly CuentaOrigen[];

/** Lista completa del catálogo (solo lectura). */
export function listarCuentasOrigen(): readonly CuentaOrigen[] {
  return CUENTAS_ORIGEN;
}

/** `true` si `id` corresponde a una cuenta de origen conocida del catálogo. */
export function esCuentaOrigenValida(id: string): boolean {
  return CUENTAS_ORIGEN.some((cuenta) => cuenta.id === id);
}
