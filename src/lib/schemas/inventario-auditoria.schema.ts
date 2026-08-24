import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────────
// HU-A7 — Auditoría de Inventario y Verificación SHA-256
// ──────────────────────────────────────────────────────────────────────────────

/** Tablas del Módulo A expuestas como opciones de filtro "módulo". */
const TABLAS_MODULO_A = [
  "legajos_prueba",
  "stock_depositos",
  "movimientos_stock",
  "variantes_sku",
  "depositos",
  "productos_maestros",
] as const;

/**
 * Filtros para la consulta de logs de auditoría del Módulo A (Inventario).
 *
 * CA 2 — filtros soportados:
 *  - `usuario_id`      → por usuario responsable del evento
 *  - `sku_referencia`  → por SKU (busca en registro_id vía ILIKE)
 *  - `fecha_desde`     → límite inferior del rango de fechas
 *  - `fecha_hasta`     → límite superior del rango de fechas
 *  - `tipo_movimiento` → por tipo de acción registrada
 *  - `tabla_afectada`  → por módulo/entidad afectada (dentro del dominio A)
 */
export const FiltrosAuditoriaInventarioSchema = z
  .object({
    usuario_id: z.string().uuid().optional(),
    sku_referencia: z.string().max(200).optional(),
    fecha_desde: z.coerce.date().optional(),
    fecha_hasta: z.coerce.date().optional(),
    tipo_movimiento: z
      .enum(["INGRESO", "EGRESO", "AJUSTE", "TRANSFERENCIA", "CREATE", "UPDATE", "DELETE", "LECTURA_SENSIBLE"])
      .optional(),
    tabla_afectada: z.enum(TABLAS_MODULO_A).optional(),
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
