/**
 * HU-A1 — Sección 4/6.3 de `docs/tasks/task_relos.md`.
 * Contrato público consumido por el resto del Módulo A (en particular HU-A2)
 * para generar y/o parsear SKUs. Ambas funciones son puras: mismos inputs →
 * mismo output, siempre, sin acceso a Prisma ni a ningún otro efecto lateral.
 */

export type Genero = "HOMBRE" | "MUJER" | "UNISEX";

const CODIGO_GENERO: Record<Genero, string> = {
  HOMBRE: "H",
  MUJER: "M",
  UNISEX: "U",
};

/**
 * Construye el SKU determinístico: [PRODUCTO]-[MODELO]-[TALLE]-[COLOR]-[GÉNERO].
 * `codigoColor` debe venir ya abreviado (ver catálogo de colores institucional,
 * pendiente de definición — sección 2 de task_relos.md).
 */
export function generarSku(params: {
  codigoProducto: string;
  modelo: string;
  talle: string;
  codigoColor: string;
  genero: Genero;
}): string {
  const { codigoProducto, modelo, talle, codigoColor, genero } = params;
  return [codigoProducto, modelo, talle, codigoColor, CODIGO_GENERO[genero]]
    .map((segmento) => segmento.trim().toUpperCase())
    .join("-");
}

/**
 * Key determinística para una combinación talle/color/género dentro de una
 * misma matriz — usada para asociar un EAN-13 escaneado/tipeado (client-side,
 * por fila del preview) con la combinación que le corresponde una vez que
 * `generarVariantesMatriz()` (servicio) reconstruye el mismo cartesiano
 * server-side. Normalizada igual que cada segmento en `generarSku()` (trim +
 * mayúsculas) para que cliente y servidor calculen siempre la misma key ante
 * los mismos valores.
 */
export function claveCombinacionVariante(params: {
  talle: string;
  color: string;
  genero: Genero;
}): string {
  const { talle, color, genero } = params;
  return [talle, color, genero].map((segmento) => segmento.trim().toUpperCase()).join("|");
}
