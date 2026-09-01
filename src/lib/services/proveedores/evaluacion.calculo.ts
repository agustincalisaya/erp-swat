/**
 * HU-H5 (Módulo H) — Funciones puras de cálculo de sub-puntajes y puntaje
 * total de una `EvaluacionProveedor` (task_relos.md, Sección 6.2). Sin
 * acceso a Prisma ni a ningún I/O: reciben los datos ya leídos y devuelven
 * un número. `evaluacion.service.ts` es el único llamador en producción.
 *
 * Mismo criterio que `generarSku()` (HU-A1, `lib/utils/sku.ts`): contrato
 * público, testeado unitariamente el día 1.
 */

// Import relativo con extensión explícita (`allowImportingTsExtensions` en
// tsconfig.json) — no el alias `@/lib/...` que usa el resto del proyecto —
// a propósito: este módulo debe poder importarse y ejecutarse tal cual bajo
// el test runner nativo de Node (`node --experimental-strip-types --test`,
// `package.json#scripts.test`), que no resuelve alias de `tsconfig.json`.
// Mismo motivo por el que `stock-calculos.ts`/`sku.ts` (los otros módulos
// puros testeados unitariamente) no importan nada fuera de sí mismos.
import {
  PENALIZACION_POR_DIA_ATRASO,
  PESOS_EVALUACION,
} from "./evaluacion.constants.ts";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * `puntaje_cumplimiento_plazos` (Sección 0.3):
 * `clamp(100 - dias_atraso * PENALIZACION_POR_DIA_ATRASO, 0, 100)`, donde
 * `dias_atraso` es la diferencia en días entre `fechaRecepcion` y
 * `fechaEntregaComprometida`, nunca negativa (una recepción anticipada no
 * suma puntos por encima de 100).
 *
 * Si `fechaEntregaComprometida` es `null` (la orden nunca pasó por
 * `CONFIRMAR`, spec_modulo_H.md §2.5), no hay fecha contra la cual medir
 * atraso: se devuelve 100 (sin penalización) en vez de bloquear el cálculo
 * completo de la evaluación — decisión documentada en Sección 0.3.
 */
export function calcularPuntajePlazos(
  fechaRecepcion: Date,
  fechaEntregaComprometida: Date | null,
): number {
  if (fechaEntregaComprometida === null) return 100;

  const diffMs = fechaRecepcion.getTime() - fechaEntregaComprometida.getTime();
  const diasAtraso = Math.max(0, Math.round(diffMs / MS_POR_DIA));
  const puntaje = 100 - diasAtraso * PENALIZACION_POR_DIA_ATRASO;
  return Math.min(100, Math.max(0, puntaje));
}

/**
 * `puntaje_calidad_recepcion` (Sección 0.3): porcentaje de `RecepcionItem`
 * de la recepción que NO tienen ninguna `RecepcionDiscrepancia` asociada,
 * sobre el total de ítems de esa recepción.
 *
 * `totalItems === 0` no debería ocurrir (una recepción sin ítems es un
 * estado inválido que otro punto del sistema ya rechaza), pero se devuelve
 * 100 por seguridad en vez de `NaN` por división por cero.
 */
export function calcularPuntajeCalidad(
  totalItems: number,
  itemsConDiscrepancia: number,
): number {
  if (totalItems === 0) return 100;

  const itemsSinDiscrepancia = totalItems - itemsConDiscrepancia;
  return Math.round((100 * itemsSinDiscrepancia) / totalItems);
}

/**
 * `puntaje_total` (Sección 0.1): combinación ponderada de los tres
 * sub-puntajes según `PESOS_EVALUACION`, redondeada a 2 decimales
 * (`EvaluacionProveedor.puntaje_total` es `Decimal(5, 2)`).
 */
export function calcularPuntajeTotal(
  plazos: number,
  calidad: number,
  documentacion: number,
): number {
  const total =
    plazos * PESOS_EVALUACION.plazos +
    calidad * PESOS_EVALUACION.calidad +
    documentacion * PESOS_EVALUACION.documentacion;
  return Math.round(total * 100) / 100;
}
