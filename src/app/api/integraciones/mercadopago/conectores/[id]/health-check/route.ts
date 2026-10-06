/**
 * @module route — POST /api/integraciones/mercadopago/conectores/[id]/health-check
 * @description HU-F1 (spec_modulo_F.md §2.1.2) — Health-check del Conector.
 * Wrapper fino: sesión + permiso granular, delega en el service (que a su vez
 * llama al Adapter) y mapea al shape `{ data, error }`.
 *
 * Respuestas: 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN · 404 CONECTOR_NO_ENCONTRADO ·
 * 422 HEALTH_CHECK_FALLIDO · 422 HEALTH_CHECK_REQUERIDO · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  ejecutarHealthCheck,
  PERMISO_ADMINISTRAR_CONECTOR,
} from "@/lib/services/integraciones/conector-pago.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CONECTOR_NO_ENCONTRADO: 404,
  HEALTH_CHECK_FALLIDO: 422,
  HEALTH_CHECK_REQUERIDO: 422,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const POST = withPermission(
  PERMISO_ADMINISTRAR_CONECTOR,
  async (_req: NextRequest, _session, rawContext) => {
    // Next.js 16: `params` es una Promise.
    const { id } = await (rawContext as Context).params;

    try {
      const data = await ejecutarHealthCheck(id);
      return NextResponse.json({ data, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      console.error(
        "[POST /api/integraciones/mercadopago/conectores/[id]/health-check] Error inesperado:",
        err,
      );
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
