import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";

export function errorCategoriaGasto(error: unknown, contexto: string): NextResponse {
  if (error instanceof ServiceError) {
    const status = error.code === "CATEGORIA_GASTO_NO_ENCONTRADA" ? 404 : 409;
    return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status });
  }
  console.error(`[HU-G12] ${contexto}:`, error);
  return NextResponse.json(
    { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
    { status: 500 },
  );
}

export function validacionCategoriaGasto(message: string): NextResponse {
  return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message } }, { status: 400 });
}
