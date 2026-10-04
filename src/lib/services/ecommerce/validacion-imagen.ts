/**
 * HU-E11 — Validación de una foto del catálogo web (spec_modulo_E.md §2.11;
 * task_relos.md D2, D8, D21, D22).
 *
 * El formato se decide por la FIRMA DE BYTES del contenido, nunca por la
 * extensión ni por el `Content-Type` que manda el cliente. Función pura (sin
 * Prisma ni `server-only`) para poder testearla con `node --test`. Los límites
 * (formatos y tamaño) llegan desde `ConfiguracionSistema`, no se fijan acá.
 */

/** Formatos que el sistema sabe detectar. La configuración elige un subconjunto. */
export const FORMATOS_IMAGEN_CONOCIDOS = ["JPG", "PNG", "WEBP"] as const;
export type FormatoImagen = (typeof FORMATOS_IMAGEN_CONOCIDOS)[number];

/** Extensión y `Content-Type` de cada formato (los usan el Adapter y la ruta pública). */
export const EXTENSION_POR_FORMATO: Record<FormatoImagen, "jpg" | "png" | "webp"> = {
  JPG: "jpg",
  PNG: "png",
  WEBP: "webp",
};
export const CONTENT_TYPE_POR_EXTENSION: Record<"jpg" | "png" | "webp", string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function empiezaCon(buffer: Uint8Array, firma: readonly number[], desde = 0): boolean {
  if (buffer.length < desde + firma.length) return false;
  return firma.every((byte, i) => buffer[desde + i] === byte);
}

/** JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`; otro → `null`. */
export function detectarFormatoImagen(buffer: Uint8Array): FormatoImagen | null {
  if (empiezaCon(buffer, [0xff, 0xd8, 0xff])) return "JPG";
  if (empiezaCon(buffer, FIRMA_PNG)) return "PNG";
  // "RIFF" + 4 bytes de tamaño + "WEBP".
  if (empiezaCon(buffer, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return "WEBP";
  return null;
}

export type ErrorValidacionImagen = "ARCHIVO_VACIO" | "ARCHIVO_DEMASIADO_GRANDE" | "FORMATO_IMAGEN_NO_ADMITIDO";

export type ResultadoValidacionImagen =
  | { ok: true; formato: FormatoImagen }
  | { ok: false; error: ErrorValidacionImagen };

/**
 * Orden fijo: vacío → tamaño → formato. El tamaño exactamente igual al máximo
 * se admite; un byte más, no.
 */
export function validarImagen(entrada: {
  buffer: Uint8Array;
  formatosPermitidos: readonly FormatoImagen[];
  tamanoMaxBytes: number;
}): ResultadoValidacionImagen {
  if (entrada.buffer.length === 0) return { ok: false, error: "ARCHIVO_VACIO" };
  if (entrada.buffer.length > entrada.tamanoMaxBytes) return { ok: false, error: "ARCHIVO_DEMASIADO_GRANDE" };
  const formato = detectarFormatoImagen(entrada.buffer);
  if (!formato || !entrada.formatosPermitidos.includes(formato)) {
    return { ok: false, error: "FORMATO_IMAGEN_NO_ADMITIDO" };
  }
  return { ok: true, formato };
}

/** Mensajes en español de cada error (servicio y UI). */
export const MENSAJE_ERROR_IMAGEN: Record<ErrorValidacionImagen, string> = {
  ARCHIVO_VACIO: "El archivo está vacío",
  ARCHIVO_DEMASIADO_GRANDE: "El archivo supera el tamaño máximo permitido",
  FORMATO_IMAGEN_NO_ADMITIDO: "El formato de la imagen no está admitido",
};

/**
 * Nombre de archivo que genera el servidor: UUID en minúsculas + extensión del
 * formato detectado. Más estricto que `[0-9a-f-]{36}` (D27): exige los guiones
 * en su lugar. Sin `/`, `\` ni `.` extra → no admite path traversal.
 */
export const PATRON_NOMBRE_FOTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
