/**
 * HU-E11 — Imágenes mínimas VÁLIDAS (1×1) generadas en memoria para los tests
 * (task_relos.md §6). No se leen archivos del repo ni del sistema: los bytes
 * están acá y se decodifican en cada llamada.
 */

const BASE64 = {
  // PNG 1×1 RGBA.
  PNG: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  // JPEG 1×1 baseline (JFIF).
  JPG:
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  // WebP 1×1 lossless (VP8L).
  WEBP: "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
} as const;

export type FormatoFixture = keyof typeof BASE64;

/** Bytes de una imagen mínima válida del formato pedido. */
export function imagenMinima(formato: FormatoFixture): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(BASE64[formato], "base64"));
}

/** Texto plano (no es imagen), para el caso "`.jpg` cuyo contenido es texto". */
export function textoComoImagen(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode("esto no es una imagen, aunque se llame foto.jpg");
}

/** JPEG válido rellenado hasta `tamano` bytes (los bytes extra van después de la firma). */
export function jpgDeTamano(tamano: number): Uint8Array<ArrayBuffer> {
  const base = imagenMinima("JPG");
  const resultado = new Uint8Array(Math.max(tamano, base.length));
  resultado.set(base);
  return resultado.subarray(0, tamano);
}
