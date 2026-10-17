import { z } from "zod";

/**
 * Schemas Zod de HU-D6 — alertas de indicadores críticos
 * (spec_modulo_D.md §8.2, task_relos.md D10/D24).
 *
 * Lo reusan el getter estricto `obtenerUmbralesEgresos()` (lectura de
 * `ConfiguracionSistema`) y, en el Paso 6, el `PATCH` de umbrales: una sola
 * definición de "conjunto de umbrales válido".
 */

/** Tope de cada umbral del porcentaje de egresos sobre ingresos (D24). */
export const UMBRAL_EGRESOS_MAXIMO = 1000;

const umbral = (nombre: string) =>
  z
    .number({
      required_error: `Falta el umbral ${nombre}`,
      invalid_type_error: `El umbral ${nombre} debe ser un número entero`,
    })
    .int(`El umbral ${nombre} debe ser un número entero`)
    .positive(`El umbral ${nombre} debe ser mayor que cero`)
    .max(UMBRAL_EGRESOS_MAXIMO, `El umbral ${nombre} no puede superar ${UMBRAL_EGRESOS_MAXIMO}`);

/**
 * Los tres umbrales del porcentaje de egresos sobre ingresos, en %: enteros
 * positivos hasta 1000 y estrictamente crecientes
 * (`informativa < advertencia < critica`). Se valida el conjunto completo.
 */
export const UmbralesEgresosSchema = z
  .object({
    informativa: umbral("informativo"),
    advertencia: umbral("de advertencia"),
    critica: umbral("crítico"),
  })
  .strict()
  .refine((u) => u.informativa < u.advertencia && u.advertencia < u.critica, {
    message: "Los umbrales deben ser estrictamente crecientes: informativa < advertencia < crítica",
    path: ["advertencia"],
  });
export type UmbralesEgresos = z.infer<typeof UmbralesEgresosSchema>;

/** Pestañas del panel (D12), tal como viajan en la URL. */
export const ESTADOS_FILTRO_ALERTAS = ["activas", "resueltas", "todas"] as const;
/** Selector de nivel (D12); ausente = todos los niveles. */
export const NIVELES_FILTRO_ALERTAS = ["critica", "advertencia", "informativa"] as const;

/**
 * Query del listado del panel (`GET /api/tesoreria/alertas` y la página).
 * Mismo criterio de paginación que los listados de Tesorería
 * (`page` / `page_size`, máximo 100).
 */
export const FiltrosPanelAlertasSchema = z.object({
  estado: z
    .enum(ESTADOS_FILTRO_ALERTAS, { errorMap: () => ({ message: "El estado debe ser activas, resueltas o todas" }) })
    .default("activas"),
  nivel: z
    .enum(NIVELES_FILTRO_ALERTAS, { errorMap: () => ({ message: "El nivel debe ser critica, advertencia o informativa" }) })
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});
export type FiltrosPanelAlertas = z.infer<typeof FiltrosPanelAlertasSchema>;
