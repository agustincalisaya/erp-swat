/**
 * @module error-mapper
 * @description Mapeo central de errores de dominio de HU-E12 a status HTTP.
 *
 * No expone stack trace, SQL, PII, tokens ni datos internos de otros pedidos.
 */
import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";

const forbiddenCodes = new Set([
  "OPERADOR_NO_AUTORIZADO",
]);

const conflictCodes = new Set([
  "ESTADO_INVALIDO",
  "PEDIDO_YA_TOMADO",
  "CONCURRENCIA_ASIGNACION",
  "PEDIDO_NO_ASIGNADO",
  "SCAN_ID_CONFLICTO",
  "CODIGO_NO_RESUELTO",
  "CODIGO_NO_PERTENECE_PEDIDO",
  "CANTIDAD_YA_COMPLETA",
  "PREPARACION_INCOMPLETA",
]);

const notFoundCodes = new Set([
  "PEDIDO_NO_OPERABLE",
]);

const internalCodes = new Set([
  "CONFIGURACION_INVALIDA",
  "ESTADO_INCONSISTENTE",
  "INCONSISTENCIA_PREPARACION",
]);

export function mapearErrorPickPack(error: ServiceError): NextResponse {
  let status: number;
  if (forbiddenCodes.has(error.code)) {
    status = 403;
  } else if (conflictCodes.has(error.code)) {
    status = 409;
  } else if (notFoundCodes.has(error.code)) {
    status = 404;
  } else if (internalCodes.has(error.code)) {
    status = 500;
  } else {
    status = 500;
  }

  return NextResponse.json(
    { data: null, error: { code: error.code, message: error.message } },
    { status },
  );
}
