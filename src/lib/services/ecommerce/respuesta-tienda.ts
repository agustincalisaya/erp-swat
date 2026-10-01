/**
 * HU-E1 — Mapeo `ServiceError.code` → status HTTP de las rutas `app/api/tienda/**`
 * (convenciones de spec_modulo_E.md §2: `{ data, error: { code, message, details? } }`).
 * `details` se propaga solo en los errores por ítem (CA4: el aviso identifica
 * el artículo afectado).
 */
import "server-only";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  VARIANTE_NO_ENCONTRADA: 404,
  ITEM_CARRITO_NO_ENCONTRADO: 404,
  PRODUCTO_WEB_NO_ENCONTRADO: 404,
  ARTICULO_NO_DISPONIBLE: 422,
  STOCK_INSUFICIENTE: 422,
  CARRITO_VACIO: 422,
  CUENTA_VINCULACION_PENDIENTE: 403,
  CHECKOUT_EN_CURSO: 409,
  // Errores de configuración del canal web: no se disfrazan de "sin stock".
  CANAL_WEB_NO_CONFIGURADO: 503,
  CONFIGURACION_NO_ENCONTRADA: 503,
  CONFIGURACION_INVALIDA: 503,
  CANAL_WEB_SIN_USUARIO_SISTEMA: 503,
};

const CODIGOS_CON_DETALLE = new Set(["ARTICULO_NO_DISPONIBLE", "STOCK_INSUFICIENTE"]);

export function respuestaOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data, error: null }, { status });
}

export function respuestaValidacion(error: ZodError): NextResponse {
  return NextResponse.json(
    {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        fieldErrors: error.flatten().fieldErrors,
      },
    },
    { status: 400 },
  );
}

export function respuestaError(err: unknown, ruta: string): NextResponse {
  if (err instanceof ServiceError && STATUS_POR_CODIGO[err.code]) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: err.code,
          message: err.message,
          ...(CODIGOS_CON_DETALLE.has(err.code) && err.details ? { details: err.details } : {}),
        },
      },
      { status: STATUS_POR_CODIGO[err.code] },
    );
  }
  console.error(`[${ruta}] Error inesperado:`, err);
  return NextResponse.json(
    { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
    { status: 500 },
  );
}
