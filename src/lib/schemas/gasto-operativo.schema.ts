import { z } from "zod";

export const GastoOperativoIdSchema = z.string().uuid("ID de gasto inválido");
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato AAAA-MM-DD");
const monto = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "El monto debe ser positivo y tener hasta dos decimales")
  .refine((value) => Number(value) > 0, "El monto debe ser mayor a cero");
export const CrearGastoOperativoSchema = z.object({
  categoria_gasto_id: z.string().uuid("Categoría inválida"),
  fecha, monto, descripcion: z.string().trim().min(1, "La descripción es obligatoria"),
}).strict();
export const EditarGastoOperativoSchema = CrearGastoOperativoSchema.partial().refine(
  (value) => Object.keys(value).length > 0, "Indicá al menos un campo para editar",
);
export const DarDeBajaGastoOperativoSchema = z.object({
  deletion_reason: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres"),
}).strict();
export const ListarGastosOperativosSchema = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido").optional(),
  categoria_gasto_id: z.string().uuid("Categoría inválida").optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type CrearGastoOperativoInput = z.infer<typeof CrearGastoOperativoSchema>;
export type EditarGastoOperativoInput = z.infer<typeof EditarGastoOperativoSchema>;
export type DarDeBajaGastoOperativoInput = z.infer<typeof DarDeBajaGastoOperativoSchema>;
export type ListarGastosOperativosInput = z.infer<typeof ListarGastosOperativosSchema>;
