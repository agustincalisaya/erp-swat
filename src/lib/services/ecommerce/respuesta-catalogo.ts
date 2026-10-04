/**
 * HU-E5 — Respuestas de las rutas de administración del catálogo web
 * `app/api/ecommerce/catalogo/**` (spec_modulo_E.md §2.5). Mismo envelope que
 * `respuesta-cupones.ts`; un contenido inexistente o dado de baja es 404.
 */
import "server-only";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { ServiceError } from "@/lib/errors/service-error";
import { ProductoWebIdSchema } from "@/lib/schemas/ecommerce.schema";

const STATUS_POR_CODIGO: Record<string, number> = {
  PRODUCTO_WEB_NO_ENCONTRADO: 404,
  // HU-E11 (task_relos.md D22, D23): contenido y fotos del catálogo.
  PRODUCTO_MAESTRO_NO_ENCONTRADO: 404,
  FOTO_WEB_NO_ENCONTRADA: 404,
  CONTENIDO_WEB_EXISTENTE: 409,
  LIMITE_FOTOS_ALCANZADO: 409,
  ARCHIVO_VACIO: 422,
  ARCHIVO_DEMASIADO_GRANDE: 422,
  FORMATO_IMAGEN_NO_ADMITIDO: 422,
};

export function respuestaOkCatalogo<T>(data: T): NextResponse {
  return NextResponse.json({ data, error: null }, { status: 200 });
}

export function respuestaValidacionCatalogo(error: ZodError): NextResponse {
  const { fieldErrors, formErrors } = error.flatten();
  return NextResponse.json(
    {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: formErrors[0] ?? Object.values(fieldErrors).flat()[0] ?? "Los datos enviados no son válidos",
        fieldErrors,
        formErrors,
      },
    },
    { status: 400 },
  );
}

export function respuestaErrorCatalogo(err: unknown, ruta: string): NextResponse {
  if (err instanceof ServiceError && STATUS_POR_CODIGO[err.code]) {
    return NextResponse.json(
      { data: null, error: { code: err.code, message: err.message } },
      { status: STATUS_POR_CODIGO[err.code] },
    );
  }
  console.error(`[${ruta}] Error inesperado:`, err);
  return NextResponse.json(
    { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
    { status: 500 },
  );
}

/** Body JSON o `null` si no es JSON válido (lo rechaza el schema con 400). */
export async function leerJsonCatalogo(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

/** Valida el `[producto_web_id]` de la ruta (UUID). */
export function parsearProductoWebId(valor: string) {
  return ProductoWebIdSchema.safeParse(valor);
}
