import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────────
// HU-A7 — Auditoría de Inventario y Verificación SHA-256
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Filtros para la consulta de logs de auditoría del Módulo A (Inventario).
 * El filtro `tabla_afectada` se limita server-side a las tablas del dominio
 * de inventario — nunca se expone el AuditLog completo de otros módulos
 * desde esta vista.
 *
 * `sku_referencia` se usa como filtro textual sobre `registro_id`, ya que
 * el AuditLog almacena el `variante_sku_id` (UUID) como `registro_id` en
 * los eventos de stock.
 */
export const FiltrosAuditoriaInventarioSchema = z
  .object({
    usuario_id: z.string().uuid().optional(),
    sku_referencia: z.string().optional(),
    fecha_desde: z.coerce.date().optional(),
    fecha_hasta: z.coerce.date().optional(),
    tipo_movimiento: z
      .enum(["INGRESO", "EGRESO", "AJUSTE", "TRANSFERENCIA"])
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(
    (data) =>
      !data.fecha_desde ||
      !data.fecha_hasta ||
      data.fecha_desde <= data.fecha_hasta,
    {
      message: "fecha_desde no puede ser posterior a fecha_hasta",
      path: ["fecha_desde"],
    },
  );

export type FiltrosAuditoriaInventarioInput = z.infer<
  typeof FiltrosAuditoriaInventarioSchema
>;

/**
 * Schema de entrada para revelar un dato sensible cifrado desde la vista
 * forense de inventario. El `registro_id` corresponde al ID del LegajoPrueba
 * que contiene los datos AES-256-GCM.
 */
export const RevelarDatoSensibleSchema = z.object({
  legajo_prueba_id: z.string().uuid("El ID del legajo debe ser un UUID válido"),
  campo: z.enum(["efectivo_placa", "efectivo_organismo"], {
    errorMap: () => ({ message: "Campo sensible no válido" }),
  }),
});

export type RevelarDatoSensibleInput = z.infer<typeof RevelarDatoSensibleSchema>;
