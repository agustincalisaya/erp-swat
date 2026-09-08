import { z } from "zod";

/**
 * Schemas Zod de HU-H9 — Registro de Comprobantes de Proveedor
 * (spec_modulo_H.md §2.7 / §2.7.1).
 *
 * Convención del módulo (spec §2, "Convenciones generales", igual que
 * `ordenes-compra.schema.ts` / `recepciones.schema.ts`): los `*_id` se validan
 * solo como `uuid` de forma; la existencia real contra la base es
 * responsabilidad de la capa de servicios (`comprobante-proveedor.service.ts`),
 * nunca de estos schemas.
 *
 * `orden_compra_id` y `proveedor_id` NO forman parte del payload de alta:
 *  - `orden_compra_id` viaja por el path param `[id]` de la ruta.
 *  - `proveedor_id` se resuelve siempre server-side desde
 *    `orden_compra.proveedor_id` (mismo principio que "el cliente nunca envía
 *    el precio" de §2.4). Ver `RegistrarComprobanteProveedorSchema`.
 */

/** Tipos de comprobante fiscal admitidos por HU-H9 — enum cerrado (spec §2.7.1). */
export const TIPOS_COMPROBANTE = [
  "FACTURA_A",
  "FACTURA_B",
  "FACTURA_C",
  "FACTURA_M",
] as const;

export type TipoComprobanteValor = (typeof TIPOS_COMPROBANTE)[number];

/** `id` de una OrdenCompra recibido por path param (alta / listado por OC). */
export const ComprobanteOrdenCompraIdSchema = z
  .string()
  .uuid("El identificador de la orden de compra debe ser un UUID válido");

/** `id` de un ComprobanteProveedor recibido por path param (anulación). */
export const ComprobanteProveedorIdSchema = z
  .string()
  .uuid("El identificador del comprobante debe ser un UUID válido");

// ──────────────────────────────────────────────────────────────────────────────
// §2.7 — Alta de comprobante (POST /api/ordenes-compra/[id]/comprobantes)
// ──────────────────────────────────────────────────────────────────────────────

export const RegistrarComprobanteProveedorSchema = z.object({
  tipo: z.enum(TIPOS_COMPROBANTE),
  numero_comprobante: z
    .string()
    .trim()
    .min(1, "El número de comprobante es obligatorio")
    .max(100, "El número de comprobante admite hasta 100 caracteres"),
  fecha_emision: z.coerce.date({ invalid_type_error: "La fecha de emisión es inválida" }),
  monto_total: z.coerce
    .number()
    .positive("El monto total debe ser mayor a 0"),
  // Opcional (criterio de aceptación de HU-H9): URL del archivo digitalizado
  // (PDF/imagen) ya subido a un storage externo — este schema NO recibe el
  // binario, solo la referencia.
  archivo_adjunto_url: z
    .string()
    .url("La URL del archivo adjunto es inválida")
    .optional(),
});
export type RegistrarComprobanteProveedorInput = z.infer<
  typeof RegistrarComprobanteProveedorSchema
>;

// ──────────────────────────────────────────────────────────────────────────────
// §2.7 — Anulación de comprobante (PATCH /api/comprobantes-proveedor/[id]/anular)
// ──────────────────────────────────────────────────────────────────────────────

export const AnularComprobanteProveedorSchema = z.object({
  deletion_reason: z
    .string()
    .trim()
    .min(1, "El motivo de anulación es obligatorio")
    .max(500, "El motivo de anulación admite hasta 500 caracteres"),
});
export type AnularComprobanteProveedorInput = z.infer<
  typeof AnularComprobanteProveedorSchema
>;

// ──────────────────────────────────────────────────────────────────────────────
// Filtros del listado global `GET /api/comprobantes-proveedor` (insumo HU-G10).
// Convención `page` / `page_size` alineada al precedente del proyecto
// (`cuentas-por-pagar.schema.ts` / `auditoria.schema.ts`). El filtro de
// comprobantes anulados NO es un query param: se decide server-side según el
// rol de quien consulta (RULES.md Regla N.° 1 — solo Auditoría ve inactivos).
// ──────────────────────────────────────────────────────────────────────────────

export const FiltrosListadoComprobantesProveedorSchema = z.object({
  proveedor_id: z.string().uuid().optional(),
  orden_compra_id: z.string().uuid().optional(),
  tipo: z.enum(TIPOS_COMPROBANTE).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});
export type FiltrosListadoComprobantesProveedorInput = z.infer<
  typeof FiltrosListadoComprobantesProveedorSchema
>;
