import { z } from "zod";

export const CategoriaGastoIdSchema = z.string().uuid("ID de categoría inválido");
export const CrearCategoriaGastoSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  descripcion: z.string().trim().optional(),
}).strict();
export const EditarCategoriaGastoSchema = CrearCategoriaGastoSchema.partial().refine(
  (valor) => Object.keys(valor).length > 0,
  "Indicá al menos un campo para editar",
);
export const DarDeBajaCategoriaGastoSchema = z.object({
  deletion_reason: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres"),
}).strict();

export type CrearCategoriaGastoInput = z.infer<typeof CrearCategoriaGastoSchema>;
export type EditarCategoriaGastoInput = z.infer<typeof EditarCategoriaGastoSchema>;
export type DarDeBajaCategoriaGastoInput = z.infer<typeof DarDeBajaCategoriaGastoSchema>;
