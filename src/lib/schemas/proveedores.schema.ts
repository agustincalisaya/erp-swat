import { z } from "zod";

/**
 * HU-H5 (Módulo H) — Evaluación de proveedores.
 *
 * No se expone como Route Handler ni Server Action propios en este PR — se
 * invoca internamente desde `recepcion.service.ts` (HU-H4, task_relos.md
 * Sección 0.5). El schema queda igual documentado por si en el futuro se
 * expone una vía manual (ej. carga de documentación por un Supervisor de
 * Compras).
 */
export const RegistrarEvaluacionDesdeRecepcionSchema = z.object({
  recepcion_id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  /** Insumo opcional de Módulo I (todavía no existe) — manual por ahora. */
  devoluciones_fabricacion: z.number().int().nonnegative().optional(),
  /** Insumo opcional de documentación — manual por ahora (Sección 0.4). */
  puntaje_documentacion_override: z.number().int().min(0).max(100).optional(),
  observaciones: z.string().optional(),
});
export type RegistrarEvaluacionDesdeRecepcionInput = z.infer<
  typeof RegistrarEvaluacionDesdeRecepcionSchema
>;
