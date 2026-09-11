import { z } from "zod";

export const RegistrarRecepcionSchema = z
  .object({
    deposito_destino_id: z.string().uuid("Seleccioná un depósito destino"),
    clave_idempotencia: z.string().uuid("La clave de idempotencia debe ser un UUID válido"),
  })
  .strict("El payload contiene campos que no pertenecen a HU-H4 V2.1");

const FechaEmisionFiltroSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((fecha) => {
    const parsed = new Date(`${fecha}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(fecha);
  });

export const FiltrosOrdenesRecepcionablesSchema = z.object({
  proveedorId: z.string().uuid().optional().catch(undefined),
  fechaEmision: FechaEmisionFiltroSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

export type RegistrarRecepcionInput = z.infer<typeof RegistrarRecepcionSchema>;
