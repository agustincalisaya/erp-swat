/**
 * HU-E11 — Gateway de almacenamiento de imágenes del catálogo web
 * (spec_modulo_E.md §2.11; task_relos.md D2, RULES Regla 3).
 *
 * Interfaz propia del dominio: los servicios no conocen el proveedor (disco
 * local hoy; S3, Vercel Blob u otro mañana = un Adapter nuevo). El NOMBRE del
 * archivo lo genera siempre el Adapter (UUID + extensión del formato
 * detectado): nada que mande el cliente influye en la ruta de escritura ni de
 * lectura (D2, D27).
 */
import type { FormatoImagen } from "@/lib/services/ecommerce/validacion-imagen";

export interface ImagenGuardada {
  /** Nombre generado por el servidor (`<uuid>.<ext>`). */
  nombre: string;
  /** URL ya resuelta que se persiste en `ProductoWebFoto.url` (D19: relativa). */
  url: string;
}

export interface ImagenLeida {
  contenido: Uint8Array;
  contentType: string;
}

export interface AlmacenamientoImagenesGateway {
  /** Guarda bytes ya validados. Nunca sobrescribe un archivo existente. */
  guardarImagen(entrada: { contenido: Uint8Array; formato: FormatoImagen }): Promise<ImagenGuardada>;
  /** Lee una imagen por su nombre; `null` si el nombre no es válido o no existe. */
  leerImagen(nombre: string): Promise<ImagenLeida | null>;
}

/** Prefijo público de las fotos guardadas (ruta `GET /api/tienda/fotos/[archivo]`). */
export const PREFIJO_URL_FOTOS = "/api/tienda/fotos/";
