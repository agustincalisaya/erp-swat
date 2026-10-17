/**
 * @module route — PATCH /api/integraciones/mercadopago/conectores/[id]/baja
 * @description HU-F1 (spec_modulo_F.md §2.1.5) — Baja lógica del Conector.
 * Wrapper fino: sesión + permiso granular, Zod (motivo obligatorio), delega en
 * el service (que deja `is_active=false` y `estado=INACTIVO`) y mapea al shape
 * `{ data, error }`.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 CONECTOR_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { BajaConectorSchema } from "@/lib/schemas/integraciones.schema";
import {
  darDeBajaConector,
  PERMISO_ADMINISTRAR_CONECTOR,
} from "@/lib/services/integraciones/conector-pago.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CONECTOR_NO_ENCONTRADO: 404,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const PATCH = withPermission(
  PERMISO_ADMINISTRAR_CONECTOR,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;

    const parsed = BajaConectorSchema.safeParse(await req.json().catch(() => null));
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
      const data = await darDeBajaConector(id, session.userId, parsed.data.deletion_reason);
      return NextResponse.json({ data, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      console.error(
        "[PATCH /api/integraciones/mercadopago/conectores/[id]/baja] Error inesperado:",
        err,
      );
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
