/**
 * @module route — GET /api/tesoreria/comprobantes/[id]
 * @description HU-G3 §9.5 — Vista de un comprobante del repositorio, con su
 * comprobante original (si es Nota de Crédito) y sus Notas de Crédito (si es
 * original), según `comprobante_original_id` (G3-4). Mismo patrón que
 * `/api/ventas/comprobantes/[id]`, pero con `tesoreria:leer_comprobantes`; esa
 * ruta de HU-B7 no se toca. Solo GET (G3-5).
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 COMPROBANTE_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ComprobanteRepositorioIdSchema } from "@/lib/schemas/comprobantes-repositorio.schema";
import {
  obtenerDetalleComprobante,
  PERMISO_LEER_COMPROBANTES,
} from "@/lib/services/tesoreria/comprobantes-repositorio.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  COMPROBANTE_NO_ENCONTRADO: 404,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const GET = withPermission(
  PERMISO_LEER_COMPROBANTES,
  async (_req: NextRequest, _session, rawContext) => {
    // Next.js 16: `params` es una Promise.
    const { id } = await (rawContext as Context).params;

    const parsedId = ComprobanteRepositorioIdSchema.safeParse(id);
    if (!parsedId.success) {
      return errorJson("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido", 400);
    }

    try {
      const comprobante = await obtenerDetalleComprobante(parsedId.data);
      return NextResponse.json({ data: comprobante, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      console.error("[GET /api/tesoreria/comprobantes/[id]] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
