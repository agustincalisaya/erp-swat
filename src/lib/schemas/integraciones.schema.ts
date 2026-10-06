/**
 * @module integraciones.schema
 * @description Schemas Zod de la gestión del Conector de Mercado Pago
 * (spec_modulo_F.md §2.1.1/§2.1.4, task HU-F1 R2). Reutilizados por las 4
 * rutas ABM, el Server Action y la UI. Ninguna regla de negocio vive acá.
 */
import { z } from "zod";

/** Alta de Conector (spec F §2.1.1, exacto): 5 campos, entorno SANDBOX|PRODUCCION. */
export const CrearConectorMercadoPagoSchema = z.object({
  nombre: z.string().min(2),
  entorno: z.enum(["SANDBOX", "PRODUCCION"]),
  access_token: z.string().min(1),
  public_key: z.string().min(1),
  webhook_secret: z.string().min(1),
});

/** Baja lógica: el motivo es obligatorio (spec F §2.1.5, task HU-F1 R3.4). */
export const BajaConectorSchema = z.object({
  deletion_reason: z.string().min(1, "El motivo es obligatorio"),
});

/** Query paginada de la bitácora (spec F §2.1.4): `page_size` máximo 50. */
export const BitacoraQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
});

export type CrearConectorMercadoPagoInput = z.infer<typeof CrearConectorMercadoPagoSchema>;
export type BajaConectorInput = z.infer<typeof BajaConectorSchema>;
export type BitacoraQueryInput = z.infer<typeof BitacoraQuerySchema>;
