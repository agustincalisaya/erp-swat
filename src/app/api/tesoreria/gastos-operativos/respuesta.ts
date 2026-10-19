import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";

export function validacionGasto(message: string) {
  return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message } }, { status: 400 });
}
export function errorGasto(error: unknown, contexto: string) {
  if (error instanceof ServiceError) {
    const status = error.code === "VALIDATION_ERROR" ? 400 : error.code.endsWith("_NO_ENCONTRADA") || error.code.endsWith("_NO_ENCONTRADO") ? 404 : 409;
    return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status });
  }
  console.error(`[HU-G13] ${contexto}:`, error);
  return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
}
