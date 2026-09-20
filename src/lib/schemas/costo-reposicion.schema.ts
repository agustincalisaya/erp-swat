import { z } from "zod";

// HU-H8 — Costo de reposición vigente (spec_modulo_H.md §2.11).
// `variante_sku_id` es un path param (`[variante_sku_id]`), no un query
// param — por eso el 400 de este endpoint usa `VALIDATION_ERROR`, patrón
// mayoritario del módulo (T9), distinto del `VALIDACION_QUERY_INVALIDA` de
// HU-H7 (T9 resuelve el resto del mapeo de errores; acá solo el contrato
// de entrada).
export const CostoReposicionParamsSchema = z.object({
  variante_sku_id: z.string().uuid(),
});

export type CostoReposicionParams = z.infer<typeof CostoReposicionParamsSchema>;
