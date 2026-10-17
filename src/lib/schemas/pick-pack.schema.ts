import { z } from "zod";

/**
 * Schemas Zod de HU-E12 — Pick & Pack / Click & Collect (admisión, cola,
 * prioridad, escaneo y finalización de preparación).
 *
 * Los `*_id` recibidos por path se validan solo como UUID formales; la
 * existencia real y la autorización corresponden a la capa de servicios.
 */

/**
 * Paginación de la cola de preparación.
 * Se usa `z.coerce.number()` para aceptar strings provenientes de
 * `Object.fromEntries(req.nextUrl.searchParams.entries())`, patrón ya usado
 * en rutas paginadas del proyecto (ej. /api/auditoria/logs, /api/ventas/auditoria).
 */
export const ColaPreparacionQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(50).default(20),
});
export type ColaPreparacionQuery = z.infer<typeof ColaPreparacionQuerySchema>;

/** `id` de un pedido recibido por path param. */
export const PedidoPickPackIdSchema = z
  .string()
  .uuid("El identificador del pedido debe ser un UUID válido");

/** Cuerpo de POST /api/ecommerce/pick-pack/[id]/confirmar-item. */
export const ConfirmarItemPreparacionSchema = z
  .object({
    scan_id: z.string().uuid("scan_id debe ser un UUID válido"),
    codigo: z
      .string()
      .trim()
      .min(1, "El código escaneado no puede estar vacío"),
  })
  .strict();
export type ConfirmarItemPreparacionInput = z.infer<typeof ConfirmarItemPreparacionSchema>;

/** Cuerpo de PATCH /api/ecommerce/pick-pack/[id]/prioridad. */
export const PriorizarPedidoSchema = z
  .object({
    prioridad_manual: z.union([
      z.number().int().min(1, "La prioridad mínima es 1").max(100, "La prioridad máxima es 100"),
      z.null(),
    ]),
  })
  .strict();
export type PriorizarPedidoInput = z.infer<typeof PriorizarPedidoSchema>;

/**
 * Schemas vacíos para operaciones que no requieren body pero que el Route
 * Handler puede usar para rechazar campos no autorizados.
 */
export const TomarPedidoSchema = z.object({}).strict();
export type TomarPedidoInput = z.infer<typeof TomarPedidoSchema>;

export const CompletarPreparacionSchema = z.object({}).strict();
export type CompletarPreparacionInput = z.infer<typeof CompletarPreparacionSchema>;
