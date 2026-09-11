import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────────
// HU-A7 — Auditoría de Inventario y Verificación SHA-256
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tablas del Módulo A expuestas como opciones de filtro "módulo".
 * `transferencias_stock` y `reservas` agregadas en la ronda de corrección
 * post-HU-A7 — ver docstring de `TABLAS_MODULO_A` en
 * `auditoria.service.ts` (debe mantenerse igual a esa constante;
 * duplicada acá porque el schema no puede importar del service sin crear
 * una dependencia circular).
 */
const TABLAS_MODULO_A = [
  "stock_depositos",
  "movimientos_stock",
  "variantes_sku",
  "depositos",
  "productos_maestros",
  "transferencias_stock",
  "reservas",
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
 *
 * `tipo_movimiento` (ronda de corrección post-HU-A7, TC-HU7-07): reducido
 * de 7 a 5 valores. Se sacaron `EGRESO` y `AJUSTE` — no existe ningún
 * emisor de eventos de dominio que escriba esas dos acciones hoy
 * (`audit-log.listener.ts`), así que eran opciones huérfanas que siempre
 * devolvían 0 resultados. No es un fix de esta tarea implementarlas — son
 * funcionalidad pendiente de otra HU (recién tiene sentido reincorporarlas
 * al filtro cuando exista el evento de dominio real detrás). `TRANSFERENCIA`
 * y `DELETE` se mantienen (el bug ahí era de comparación, no de ausencia
 * de datos — corregido en `obtenerLogsInventario()` vía
 * `ACCIONES_POR_TIPO_MOVIMIENTO`, no en este schema).
 */
export const FiltrosAuditoriaInventarioSchema = z
  .object({
    usuario_id: z.string().uuid().optional(),
    sku_referencia: z.string().max(200).optional(),
    fecha_desde: z.coerce.date().optional(),
    fecha_hasta: z.coerce.date().optional(),
    tipo_movimiento: z.enum(["INGRESO", "TRANSFERENCIA", "CREATE", "UPDATE", "DELETE"]).optional(),
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
