/**
 * HU-E16 — Regla única de "contenido publicable" (spec_modulo_E.md §6.2,
 * E16-1/E16-2; docs/modulos/modulo E/HU16_TASKS.md D3, D7).
 *
 * La usan `cambiarVisibilidadWeb` (dentro de la transacción, bajo el lock del
 * contenido) y `listarContenidoWebAdmin`: una sola fuente de verdad. Función
 * pura (sin Prisma ni `server-only`) para poder testearla con `node --test` e
 * importar sus etiquetas desde la UI.
 */

export type FaltantePublicacion = "descripcion" | "foto";

export interface SnapshotPublicabilidad {
  descripcion: string;
  /** Fotos con `is_active = true` y `deleted_at = null`. */
  fotos_activas: number;
}

export interface ResultadoPublicabilidad {
  publicable: boolean;
  /** Orden canónico: `descripcion` antes que `foto` (D3). */
  faltantes: FaltantePublicacion[];
}

export function evaluarPublicabilidad(c: SnapshotPublicabilidad): ResultadoPublicabilidad {
  const faltantes: FaltantePublicacion[] = [];
  if (c.descripcion.trim().length === 0) faltantes.push("descripcion");
  if (c.fotos_activas < 1) faltantes.push("foto");
  return { publicable: faltantes.length === 0, faltantes };
}

/** Texto para la UI de backoffice. */
export const ETIQUETA_FALTANTE: Record<FaltantePublicacion, string> = {
  descripcion: "Falta la descripción",
  foto: "Falta al menos una foto activa",
};
