/**
 * HU-E4 — Respuestas de las rutas de administración `app/api/ecommerce/cupones/**`
 * (spec_modulo_E.md §2.4.e). Distinto de `respuesta-tienda.ts`: acá un cupón
 * inexistente es 404 y uno dado de baja es 409 (en el checkout ambos son 422).
 */
import "server-only";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  CUPON_NO_ENCONTRADO: 404,
  CUPON_INACTIVO: 409,
  CUPON_CODIGO_EXISTENTE: 409,
  CUPON_EDICION_RESTRINGIDA: 409,
  VALIDATION_ERROR: 400,
};

export function respuestaOkCupones<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data, error: null }, { status });
}

export function respuestaValidacionCupones(error: ZodError): NextResponse {
  return NextResponse.json(
    {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        fieldErrors: error.flatten().fieldErrors,
        formErrors: error.flatten().formErrors,
      },
    },
    { status: 400 },
  );
}

export function respuestaErrorCupones(err: unknown, ruta: string): NextResponse {
  if (err instanceof ServiceError && STATUS_POR_CODIGO[err.code]) {
    const fieldErrors = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
    return NextResponse.json(
      { data: null, error: { code: err.code, message: err.message, ...(fieldErrors ? { fieldErrors } : {}) } },
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
export async function leerJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
