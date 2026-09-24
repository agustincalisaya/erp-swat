import { z } from "zod";

/** Filtros exclusivos del modo Clientes de la consola de auditoría. */
export const FiltrosAuditoriaClientesSchema = z.object({
  modulo: z.literal("clientes"),
  cliente_nombre: z.string().trim().min(1).max(120).optional(),
  usuario_id: z.string().uuid().optional(),
  accion: z.enum(["CREATE", "UPDATE", "DELETE_LOGICO"]).optional(),
  fecha_desde: z.coerce.date().optional(),
  fecha_hasta: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine(
  (data) => !data.fecha_desde || !data.fecha_hasta || data.fecha_desde <= data.fecha_hasta,
  { message: "fecha_desde no puede ser posterior a fecha_hasta", path: ["fecha_desde"] },
);

export type FiltrosAuditoriaClientesInput = z.infer<typeof FiltrosAuditoriaClientesSchema>;
