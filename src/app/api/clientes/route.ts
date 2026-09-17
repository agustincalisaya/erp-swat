/**
 * @module route — POST /api/clientes
 * @description HU-C1 §2.1 — Alta de Cliente con validación de unicidad por
 * DNI. Wrapper fino (spec §1): resuelve sesión + permiso granular
 * (`clientes:crear`), valida con Zod, delega en `cliente.service.ts` y
 * mapea al shape `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * `es_nuevo` (devuelto por el service) decide el status: `201` en alta
 * nueva, `200` al recuperar un registro existente por DNI (spec §2.1: "esto
 * es distinto de un 409 Conflict").
 *
 * Respuestas: 200 OK (recuperado) · 201 Created (alta nueva) ·
 * 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearClienteSchema } from "@/lib/schemas/clientes.schema";
import { crearCliente, PERMISO_CREAR } from "@/lib/services/clientes/cliente.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {};

function errorJson(code: string, message: string, status: number) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const POST = withPermission(PERMISO_CREAR, async (req: NextRequest, session) => {
  const body = await req.json().catch(() => null);
  const parsed = CrearClienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Datos inválidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await crearCliente(parsed.data, session.userId);
    return NextResponse.json(
      { data: resultado, error: null },
      { status: resultado.es_nuevo ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
    }
    console.error("[POST /api/clientes] Error inesperado:", err);
    return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
  }
});
