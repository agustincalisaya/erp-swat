/**
 * HU-H5 (Módulo H) — Constantes de la evaluación de proveedores
 * (task_relos.md, Sección 0). Ningún documento fuente (`spec_modulo_H.md`,
 * `spec_modulo_D.md`, `schema.prisma`, `RULES.md`, Product Backlog) definía
 * estos 4 valores: se tomaron decisiones de ingeniería razonables para no
 * bloquear el desarrollo, documentadas acá una por una. Centralizadas en
 * este único archivo para que el equipo/PO pueda ajustarlas sin tocar
 * `evaluacion.calculo.ts` ni `evaluacion.service.ts`.
 *
 * ⚠️ Ninguno de estos 4 valores está validado todavía por el equipo/PO.
 */

/**
 * DECISIÓN PENDIENTE DE VALIDAR (Sección 0.2): umbral mínimo de
 * homologación. Vive como constante de código, no como entidad de
 * configuración en base de datos — esa entidad no existe hoy en Módulo D
 * (mismo patrón que `MAX_INTENTOS_FALLIDOS`, spec_modulo_D.md §2.1). Si
 * Módulo D expone una entidad de configuración real más adelante, migrar el
 * valor ahí sin cambiar la función de servicio.
 */
export const UMBRAL_MINIMO_HOMOLOGACION = 60;

/**
 * DECISIÓN PENDIENTE DE VALIDAR (Sección 0.1): ponderación del
 * `puntaje_total`. Igualitaria (33.3% cada criterio) porque ningún dato del
 * negocio indica que un criterio deba pesar más que otro — es el default
 * neutral, no un sesgo. El equipo/PO puede pedir otra ponderación (ej. más
 * peso a plazos y calidad que a documentación); cambia esta constante, no la
 * lógica de `calcularPuntajeTotal()`.
 */
export const PESOS_EVALUACION = {
  plazos: 1 / 3,
  calidad: 1 / 3,
  documentacion: 1 / 3,
} as const;

/**
 * DECISIÓN PENDIENTE DE VALIDAR (Sección 0.3): coeficiente de penalización
 * por día de atraso en `calcularPuntajePlazos()`
 * (`clamp(100 - dias_atraso * PENALIZACION_POR_DIA_ATRASO, 0, 100)`).
 * También pendiente: si la penalización debería variar según el `tipo` de
 * discrepancia (`CANTIDAD`/`TALLE`/`COLOR`/`CALIDAD`) — hoy todas pesan igual.
 */
export const PENALIZACION_POR_DIA_ATRASO = 5;

/**
 * DECISIÓN PENDIENTE DE VALIDAR (Sección 0.4): no existe modelo de
 * documento/vencimiento en el schema todavía, así que `puntaje_documentacion`
 * se trata como insumo manual opcional — mismo criterio que
 * `EvaluacionProveedor.devoluciones_fabricacion` (ya documentado así en
 * `schema.prisma`). Este es el valor vigente cuando no se carga un override
 * explícito. Si el equipo pide un modelo real de vencimientos documentales,
 * es una migración de schema futura, fuera de este alcance.
 */
export const PUNTAJE_DOCUMENTACION_DEFAULT = 100;
