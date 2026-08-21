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
 * Placeholder interno de `ean_qr` para variantes generadas por matriz.
 *
 * `VarianteSKU.ean_qr` es NOT NULL en el schema y, en el resto del proyecto
 * (spec_modulo_A.md §2.1), se recibe como código de barras EAN-13 real de
 * fábrica provisto por el cliente — algo que no existe todavía para una
 * variante recién generada por combinatoria (talle × color × género), ya
 * que el código de barras físico se conoce recién cuando el producto llega
 * al depósito y se escanea.
 *
 * Se deriva del mismo `sku` ya calculado para esa combinación: determinístico
 * ante reintentos de la generación en lote, y nunca colisiona mientras el
 * `sku` sea único (garantizado por el constraint `@unique` de la BD).
 *
 * TODO(backlog, ninguna HU de este sprint lo resuelve todavía): reemplazar
 * este placeholder por el EAN-13 real cuando la unidad física se escanea por
 * primera vez (candidato natural: el endpoint de ingreso de HU-A2). Hasta
 * entonces, "PEND-<SKU>" NO es un código de barras válido — es un marcador
 * interno para satisfacer el constraint NOT NULL de la base.
 */
export function generarEanQrPlaceholder(sku: string): string {
  return `PEND-${sku.trim().toUpperCase()}`;
}
