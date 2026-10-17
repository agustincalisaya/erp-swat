import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { ZodError } from "zod";
import { ServiceError } from "@/lib/errors/service-error";

const HEADERS_PRIVADOS = { "Cache-Control": "private, no-store" };

type HandlerHttp<C> = (request: NextRequest, context: C) => Promise<NextResponse>;

export function conCachePrivada<C>(handler: HandlerHttp<C>): HandlerHttp<C> {
  return async (request, context) => {
    const response = await handler(request, context);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
}

export function respuestaMisPedidosOk<T>(data: T): NextResponse {
  return NextResponse.json({ data, error: null }, { headers: HEADERS_PRIVADOS });
}

export function respuestaMisPedidosValidacion(_error: ZodError): NextResponse {
  return NextResponse.json(
    { data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos" } },
    { status: 400, headers: HEADERS_PRIVADOS },
  );
}

export function respuestaMisPedidosError(error: unknown, ruta: string): NextResponse {
  if (error instanceof ServiceError && error.code === "PEDIDO_NO_ENCONTRADO") {
    return NextResponse.json(
      { data: null, error: { code: "PEDIDO_NO_ENCONTRADO", message: "El pedido solicitado no existe" } },
      { status: 404, headers: HEADERS_PRIVADOS },
    );
  }
  console.error(`[${ruta}] Error inesperado`);
  return NextResponse.json(
    { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
    { status: 500, headers: HEADERS_PRIVADOS },
  );
}
