/**
 * HU-H2 (Módulo H) — Funciones PURAS (sin I/O, sin `prisma`, sin
 * `server-only`) de cálculo de variación porcentual, umbral crítico y
 * derivación de estado de una `ListaPrecioVersion`. Extraídas de
 * `lista-precios.service.ts` (que sí importa `server-only` — no puede
 * probarse bajo el script `test` plano de este proyecto) siguiendo EL MISMO
 * precedente que `evaluacion.calculo.ts` frente a `evaluacion.service.ts`
 * (HU-H5): la lógica de decisión pura vive separada del service con I/O
 * específicamente para poder testearla sin flags especiales
 * (`node --experimental-strip-types --test`).
 *
 * `lista-precios.service.ts` es la ÚNICA fuente de verdad que importa este
 * módulo para su lógica real (`publicarNuevaVersionListaPrecio`,
 * `previsualizarVariacionListaPrecios`, `listarVersionesListaPrecio`) — no
 * hay una segunda implementación de esta fórmula en ningún otro lado.
 *
 * Import RELATIVO con extensión explícita (`./lista-precios.constants.ts`),
 * no el alias `@/...`: el test unitario de este módulo corre bajo el script
 * `test` de `package.json` (`node --experimental-strip-types --test`, SIN
 * `tsx`), que no resuelve los alias de `tsconfig.json` — mismo motivo
 * documentado en `evaluacion.calculo.ts` para `evaluacion.constants.ts`.
 */

import { UMBRAL_VARIACION_CRITICA_PORCENTUAL } from "./lista-precios.constants.ts";
// Import relativo con extensión explícita, mismo motivo que arriba: helper
// PURO de "día de negocio" (seguimiento post-A3, auditoría transversal
// Módulo H, 2026-09-26 — `src/lib/utils/fecha-negocio.ts`).
import { fechaDeVigenciaAlcanzada } from "../../utils/fecha-negocio.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Cálculo de variación porcentual (propose.md — "Cálculo de variación
// porcentual y evento crítico" · Design §2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Variación % de un ítem contra su precio previamente vigente. `null` solo
 * como guarda defensiva de división por cero (`precio_anterior <= 0`) — el
 * llamador nunca invoca esta función para un ítem sin precio previo (ese
 * caso se resuelve por composición, excluyendo el ítem antes de llegar acá).
 */
export function calcularVariacionPorcentual(
  precio_anterior: number,
  precio_nuevo: number,
): number | null {
  if (precio_anterior <= 0) return null;
  return ((precio_nuevo - precio_anterior) / precio_anterior) * 100;
}

/**
 * Máximo de la magnitud (`Math.abs`) de las variaciones no-`null`: una baja
 * de precio cuenta igual que una suba del mismo tamaño. `0` si todos son
 * `null` (primera publicación completa) — sin rama de código especial,
 * resuelto naturalmente por el valor inicial `0` del `reduce`.
 */
export function calcularVariacionMaximaDelLote(
  items: { variacion_porcentual: number | null }[],
): number {
  return items.reduce((maximo, item) => {
    if (item.variacion_porcentual === null) return maximo;
    return Math.max(maximo, Math.abs(item.variacion_porcentual));
  }, 0);
}

/** Compara la variación máxima del lote contra el umbral crítico parametrizado. */
export function debeRequerirAprobacion(variacion_maxima: number): boolean {
  return variacion_maxima > UMBRAL_VARIACION_CRITICA_PORCENTUAL;
}

// ──────────────────────────────────────────────────────────────────────────────
// Preview de variación (UI "Calcular variación") — reusa los 3 helpers de
// arriba, misma decisión EXACTA que usa `publicarNuevaVersionListaPrecio`.
// ──────────────────────────────────────────────────────────────────────────────

export interface ItemConPrecioAnterior {
  variante_sku_id: string;
  /** `null` si la variante no tiene precio en la versión vigente (o no hay versión vigente) — se excluye del cálculo de variación. */
  precio_anterior: number | null;
  precio_nuevo: number;
}

export interface PreviewItemResultado extends ItemConPrecioAnterior {
  variacion_porcentual: number | null;
}

export interface PreviewListaPreciosResultado {
  items: PreviewItemResultado[];
  variacion_porcentual_maxima: number;
  requiere_aprobacion: boolean;
  umbral: number;
}

/**
 * Núcleo PURO de la decisión de preview. Recibe los ítems ya resueltos
 * contra su precio anterior (si lo tienen) y aplica la misma secuencia que
 * el paso 5-6 de `publicarNuevaVersionListaPrecio`: `calcularVariacionPorcentual`
 * por ítem con precio previo → `calcularVariacionMaximaDelLote` →
 * `debeRequerirAprobacion`. Produce exactamente la misma
 * `variacion_porcentual_maxima`/`requiere_aprobacion` que resultaría de
 * publicar esos mismos ítems.
 */
export function calcularResultadoPreview(
  items: ItemConPrecioAnterior[],
): PreviewListaPreciosResultado {
  const itemsResultado: PreviewItemResultado[] = items.map((item) => ({
    ...item,
    variacion_porcentual:
      item.precio_anterior === null
        ? null
        : calcularVariacionPorcentual(item.precio_anterior, item.precio_nuevo),
  }));

  const variacion_porcentual_maxima = calcularVariacionMaximaDelLote(itemsResultado);
  const requiere_aprobacion = debeRequerirAprobacion(variacion_porcentual_maxima);

  return {
    items: itemsResultado,
    variacion_porcentual_maxima,
    requiere_aprobacion,
    umbral: UMBRAL_VARIACION_CRITICA_PORCENTUAL,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Derivación de estado de una ListaPrecioVersion (historial de la UI)
// ──────────────────────────────────────────────────────────────────────────────

export type EstadoListaPrecioVersion =
  | "VIGENTE"
  | "HISTORICA"
  | "PENDIENTE_APROBACION"
  | "FUTURA";

/**
 * Núcleo PURO de la derivación de estado. `publicada` en el schema real es
 * `false` ÚNICAMENTE mientras la versión espera aprobación
 * (`publicarNuevaVersionListaPrecio`: `publicada = !requiere_aprobacion`),
 * así que `!publicada` implica `PENDIENTE_APROBACION` sin ambigüedad. Una
 * versión publicada cuyo DÍA DE NEGOCIO todavía no llegó es `FUTURA` (no
 * seleccionable todavía por `resolverListaPrecioVigente`); el resto es
 * `VIGENTE`/`HISTORICA` según `esVigente` (resuelto por el llamador contra
 * `obtenerVersionVigente`, misma regla de "vigente" que el resto del módulo —
 * no se reimplementa acá).
 *
 * Seguimiento post-A3 (2026-09-26, confirmado por el usuario): antes
 * comparaba INSTANTES (`fecha_inicio_vigencia > ahora`), lo que dejaba de
 * marcar "FUTURA" una fecha-solo de MAÑANA a partir de las 21:00 hora
 * Argentina (mismo bug que `obtenerVersionVigente`, ver
 * `fechaDeVigenciaAlcanzada` en `src/lib/utils/fecha-negocio.ts`) — el badge
 * mostraría "Vigente"/"Histórica" 3 h antes de tiempo.
 */
export function derivarEstadoListaPrecioVersion(
  version: { publicada: boolean; fecha_inicio_vigencia: Date },
  esVigente: boolean,
  ahora: Date = new Date(),
): EstadoListaPrecioVersion {
  if (!version.publicada) return "PENDIENTE_APROBACION";
  if (!fechaDeVigenciaAlcanzada(version.fecha_inicio_vigencia, ahora)) return "FUTURA";
  return esVigente ? "VIGENTE" : "HISTORICA";
}
