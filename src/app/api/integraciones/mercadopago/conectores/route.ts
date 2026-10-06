/**
 * @module route — POST /api/integraciones/mercadopago/conectores
 * @description HU-F1 (spec_modulo_F.md §2.1.1) — Alta del Conector de Mercado
 * Pago. Wrapper fino: sesión + permiso granular
 * (`integraciones:administrar_conector`), Zod, service y shape `{ data, error }`.
 * NINGUNA regla de negocio vive acá.
 *
 * Respuestas: 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 409 CONECTOR_ACTIVO_EXISTENTE · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { CrearConectorMercadoPagoSchema } from "@/lib/schemas/integraciones.schema";
import {
  crearConector,
  PERMISO_ADMINISTRAR_CONECTOR,
} from "@/lib/services/integraciones/conector-pago.service";

const STATUS_POR_CODIGO: Record<string, number> = {
  CONECTOR_ACTIVO_EXISTENTE: 409,
  CONECTOR_NO_ENCONTRADO: 404,
  HEALTH_CHECK_FALLIDO: 422,
  HEALTH_CHECK_REQUERIDO: 422,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const POST = withPermission(
  PERMISO_ADMINISTRAR_CONECTOR,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = CrearConectorMercadoPagoSchema.safeParse(body);
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
      const data = await crearConector(parsed.data, session.userId);
      return NextResponse.json({ data, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      console.error("[POST /api/integraciones/mercadopago/conectores] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
