/**
 * @module route — GET /api/integraciones/mercadopago/conectores/[id]/bitacora
 * @description HU-F1 (spec_modulo_F.md §2.1.4) — Bitácora operativa paginada
 * del Conector. Wrapper fino: sesión + permiso granular, Zod sobre los query
 * params, delega en el service y mapea al shape `{ data, error }`. Sin datos
 * sensibles.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 CONECTOR_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { BitacoraQuerySchema } from "@/lib/schemas/integraciones.schema";
import {
  listarBitacora,
  PERMISO_ADMINISTRAR_CONECTOR,
} from "@/lib/services/integraciones/conector-pago.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CONECTOR_NO_ENCONTRADO: 404,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const GET = withPermission(
  PERMISO_ADMINISTRAR_CONECTOR,
  async (req: NextRequest, _session, rawContext) => {
    const { id } = await (rawContext as Context).params;

    const parsed = BitacoraQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Query inválida",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const data = await listarBitacora(id, parsed.data);
      return NextResponse.json({ data, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      console.error(
        "[GET /api/integraciones/mercadopago/conectores/[id]/bitacora] Error inesperado:",
        err,
      );
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
