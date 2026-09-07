import { z } from "zod";

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
 * Única mutación manual de HU-G8 (spec §2.4): `DEFINITIVA → PAGADA`. No exige
 * evidencia de pago ni admite pago parcial. `fecha_pago` es opcional y por
 * defecto es "ahora"; el body completo es opcional en el call site, que hace
 * `MarcarPagadaSchema.safeParse(body ?? {})`.
 */
export const MarcarPagadaSchema = z.object({
  fecha_pago: z.coerce.date().default(() => new Date()),
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
