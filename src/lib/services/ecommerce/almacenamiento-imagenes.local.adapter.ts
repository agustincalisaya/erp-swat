/**
 * HU-E11 — Adapter de disco local del Gateway de imágenes (task_relos.md D2,
 * D24, D27). El directorio sale de `CATALOGO_FOTOS_DIR` (relativo al proceso o
 * absoluto, `path.resolve`); sin valor por defecto en código: si falta, falla
 * con un error que la ruta convierte en 500.
 *
 * Seguridad: el nombre es `randomUUID()` + extensión del formato detectado;
 * la lectura exige `PATRON_NOMBRE_FOTO` y además comprueba que la ruta
 * resuelta quede DENTRO del directorio. Nunca se borra un archivo (D29).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ServiceError } from "@/lib/errors/service-error";
import {
  PREFIJO_URL_FOTOS,
  type AlmacenamientoImagenesGateway,
} from "@/lib/services/ecommerce/almacenamiento-imagenes.gateway";
import {
  CONTENT_TYPE_POR_EXTENSION,
  EXTENSION_POR_FORMATO,
  PATRON_NOMBRE_FOTO,
} from "@/lib/services/ecommerce/validacion-imagen";

/** @throws {ServiceError} ALMACENAMIENTO_NO_CONFIGURADO — falta `CATALOGO_FOTOS_DIR` (500) */
function directorioFotos(): string {
  const valor = process.env.CATALOGO_FOTOS_DIR?.trim();
  if (!valor) {
    throw new ServiceError("ALMACENAMIENTO_NO_CONFIGURADO", "Falta la variable de entorno CATALOGO_FOTOS_DIR");
  }
  return path.resolve(valor);
}

/** Ruta absoluta de un nombre YA validado, o `null` si escaparía del directorio. */
function rutaContenida(directorio: string, nombre: string): string | null {
  const ruta = path.resolve(directorio, nombre);
  return path.dirname(ruta) === directorio ? ruta : null;
}

export const almacenamientoImagenesLocal: AlmacenamientoImagenesGateway = {
  async guardarImagen({ contenido, formato }) {
    const directorio = directorioFotos();
    const nombre = `${randomUUID()}.${EXTENSION_POR_FORMATO[formato]}`;
    const ruta = rutaContenida(directorio, nombre);
    if (!ruta) throw new ServiceError("ALMACENAMIENTO_RUTA_INVALIDA", "Ruta de almacenamiento inválida");
    await mkdir(directorio, { recursive: true });
    // `wx`: nunca sobrescribe (un UUID repetido es un error, no un reemplazo).
    await writeFile(ruta, contenido, { flag: "wx" });
    return { nombre, url: `${PREFIJO_URL_FOTOS}${nombre}` };
  },

  async leerImagen(nombre) {
    const coincide = PATRON_NOMBRE_FOTO.exec(nombre);
    if (!coincide) return null;
    const directorio = directorioFotos();
    const ruta = rutaContenida(directorio, nombre);
    if (!ruta) return null;
    try {
      const contenido = await readFile(ruta);
      return {
        contenido: new Uint8Array(contenido),
        contentType: CONTENT_TYPE_POR_EXTENSION[coincide[1] as keyof typeof CONTENT_TYPE_POR_EXTENSION],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
};

/** Fábrica única del Gateway (los tests de servicio inyectan uno en memoria). */
export function obtenerAlmacenamientoImagenes(): AlmacenamientoImagenesGateway {
  return almacenamientoImagenesLocal;
}
