import { z } from "zod";

/**
 * Schemas Zod de HU-F2 — Plantillas de notificación interna
 * (spec_modulo_F.md §2.2, docs/tasks/HU-F2.md §4).
 *
 * `tipo_evento` se valida acá solo como string no vacío: su existencia contra
 * el registro de eventos de dominio es responsabilidad de la capa de servicios
 * (`plantilla-notificacion.service.ts`), no de Zod (spec §2.2).
 *
 * La reactivación (task §4.1-bis) no lleva schema propio: no tiene body.
 */

/** `id` de una PlantillaNotificacion recibido por path param. */
export const PlantillaNotificacionIdSchema = z
  .string()
  .uuid("El identificador de la plantilla debe ser un UUID válido");

// Textual — spec_modulo_F.md §2.2
export const CrearPlantillaNotificacionSchema = z.object({
  tipo_evento: z.string().min(1, "Debe asociarse a un tipo de evento de dominio"),
  asunto: z.string().min(1),
  cuerpo: z.string().min(1), // admite placeholders {{variable}}, ver 3.2
  prioridad_default: z.enum(["CRITICA", "ADVERTENCIA", "INFORMATIVA"]),
});
export type CrearPlantillaNotificacionInput = z.infer<typeof CrearPlantillaNotificacionSchema>;

// Textual — spec_modulo_F.md §2.2
export const EditarPlantillaNotificacionSchema = z.object({
  asunto: z.string().min(1).optional(),
  cuerpo: z.string().min(1).optional(),
  prioridad_default: z.enum(["CRITICA", "ADVERTENCIA", "INFORMATIVA"]).optional(),
}).strict(); // tipo_evento no es editable — ver 3.2

/**
 * Schema que aplican Route Handler y Server Action: el del spec, intacto, más
 * el rechazo del body vacío `{}` (task §8, Punto abierto 8 RESUELTO → 400
 * VALIDATION_ERROR). El `.refine()` corre después del `.strict()`, así que un
 * `tipo_evento` en el body sigue fallando con el issue `unrecognized_keys`.
 */
export const EditarPlantillaNotificacionBodySchema = EditarPlantillaNotificacionSchema.refine(
  (input) => Object.values(input).some((valor) => valor !== undefined),
  { message: "Debe indicar al menos un campo a modificar" },
);
export type EditarPlantillaNotificacionInput = z.infer<typeof EditarPlantillaNotificacionSchema>;

// PROPUESTA aprobada (no está en el spec) — el spec no define el schema de baja.
// Modelado sobre AnularComprobanteProveedorSchema (spec_modulo_H.md §2.7), con .trim().
export const DarDeBajaPlantillaNotificacionSchema = z.object({
  deletion_reason: z.string().trim().min(1, "El motivo de baja es obligatorio"),
});
export type DarDeBajaPlantillaNotificacionInput = z.infer<
  typeof DarDeBajaPlantillaNotificacionSchema
>;

/**
 * Traduce un error de `EditarPlantillaNotificacionBodySchema` al error del
 * envelope: `CAMPO_INMUTABLE` si el body trae `tipo_evento` (spec §2.2, con el
 * mensaje de Zod tal cual), `VALIDATION_ERROR` en cualquier otro caso.
 */
export function errorEdicion(error: z.ZodError): {
  code: "CAMPO_INMUTABLE" | "VALIDATION_ERROR";
  message: string;
} {
  const inmutable = error.issues.find(
    (issue) => issue.code === "unrecognized_keys" && issue.keys.includes("tipo_evento"),
  );
  if (inmutable) return { code: "CAMPO_INMUTABLE", message: inmutable.message };
  return {
    code: "VALIDATION_ERROR",
    message: error.issues[0]?.message ?? "Datos inválidos",
  };
}
