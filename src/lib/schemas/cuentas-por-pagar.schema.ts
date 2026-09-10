import { z } from "zod";

import { esCuentaOrigenValida } from "../tesoreria/cuentas-origen.ts";

/**
 * Schemas Zod de HU-G8 — Cuenta por Pagar (spec_modulo_G.md §2.4 y §2.5).
 *
 * Convención del módulo (spec §2, "Convenciones generales", igual que
 * `ordenes-compra.schema.ts`): los `*_id` se validan solo como `uuid` de
 * forma; la existencia real contra la base es responsabilidad de la capa de
 * servicios (`cuenta-por-pagar.service.ts`), nunca de estos schemas.
 */

/** `id` de una CuentaPorPagar recibido por path param. */
export const CuentaPorPagarIdSchema = z
  .string()
  .uuid("El identificador de la cuenta por pagar debe ser un UUID válido");

// ──────────────────────────────────────────────────────────────────────────────
// §2.4 — Marcar Cuenta por Pagar como pagada (mutación manual)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Medios de pago admitidos (HU-G10). Espejo exacto del enum `MedioPago` de
 * Prisma — mantener sincronizado.
 */
export const MEDIOS_PAGO = ["TRANSFERENCIA", "CHEQUE", "EFECTIVO"] as const;

/**
 * Helper puro (HU-G10): `true` si `fecha` no es posterior a `ahora`. El pago no
 * puede registrarse con fecha futura (spec §2.4). El instante exacto `ahora` se
 * considera válido.
 */
export function esFechaPagoNoFutura(fecha: Date, ahora: Date = new Date()): boolean {
  return fecha.getTime() <= ahora.getTime();
}

/**
 * Mutación manual de pago de una Cuenta por Pagar (spec §2.4 + HU-G10):
 * `DEFINITIVA → PAGADA`. Desde HU-G10 exige `medio_pago`, `cuenta_origen_id` y
 * al menos un `comprobante_proveedor_id` imputado. `fecha_pago` es opcional
 * (por defecto "ahora") y no puede ser futura; `observaciones` es opcional y
 * acotada a 500 caracteres. La existencia real de los comprobantes y su
 * pertenencia a la OC la valida la capa de servicios.
 */
export const MarcarPagadaSchema = z.object({
  fecha_pago: z
    .coerce.date()
    .default(() => new Date())
    .refine((d) => esFechaPagoNoFutura(d), "La fecha de pago no puede ser futura"),
  medio_pago: z.enum(MEDIOS_PAGO),
  cuenta_origen_id: z
    .string()
    .refine(esCuentaOrigenValida, "La cuenta de origen no existe"),
  comprobante_proveedor_ids: z
    .array(z.string().uuid())
    .min(1, "Debés imputar al menos un comprobante")
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "No podés imputar el mismo comprobante dos veces",
    ),
  observaciones: z
    .string()
    .max(500, "Las observaciones no pueden superar los 500 caracteres")
    .optional(),
});
export type MarcarPagadaInput = z.infer<typeof MarcarPagadaSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Filtros del listado `GET /api/tesoreria/cuentas-por-pagar` (solo lectura,
// hidratados desde la URL). Convención `page` / `page_size` alineada al
// precedente real del proyecto (`auditoria.schema.ts`).
// ──────────────────────────────────────────────────────────────────────────────

/** Los 4 estados del enum `EstadoCuentaPorPagar` de Prisma (spec §3.1). */
export const ESTADOS_CUENTA_POR_PAGAR = [
  "PROVISORIO",
  "DEFINITIVA",
  "PAGADA",
  "CANCELADA",
] as const;

export type EstadoCuentaPorPagarValor = (typeof ESTADOS_CUENTA_POR_PAGAR)[number];

/**
 * Filtros de la grilla de cuentas por pagar (spec §2.5). Los tres filtros son
 * opcionales — sin filtros se lista todo lo activo. `page` / `page_size`
 * llegan siempre resueltos por los `.default()`, por eso el output es
 * asignable a `FiltrosListadoCuentasPorPagar` del servicio.
 */
export const FiltrosListadoCuentasPorPagarSchema = z.object({
  estado: z.enum(ESTADOS_CUENTA_POR_PAGAR).optional(),
  orden_compra_id: z.string().uuid().optional(),
  proveedor_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});
export type FiltrosListadoCuentasPorPagarInput = z.infer<
  typeof FiltrosListadoCuentasPorPagarSchema
>;
