/**
 * @module route — GET /api/ventas/comprobantes/[id]
 * @description HU-B7 §2.7 — Consulta de un comprobante fiscal ya emitido
 * (task_relos.md §0.3: único endpoint pendiente de esta HU, la emisión ya
 * quedó resuelta en HU-B1). Wrapper fino (spec §1): resuelve sesión +
 * permiso `ventas:leer` (todos los roles del módulo lo tienen), valida el
 * `id` de path con Zod, delega en `obtenerComprobantePorId()` y mapea el
 * resultado/excepción. NINGUNA lógica de negocio vive acá.
 *
 * No expone ni debe exponer un Route Handler de alta directa (task §1): el
 * comprobante nace siempre asociado a una venta ya existente.
 *
 * GET — 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 *       404 COMPROBANTE_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ComprobanteFiscalIdSchema } from "@/lib/schemas/ventas.schema";
import { obtenerComprobantePorId } from "@/lib/services/ventas/comprobante-fiscal.service";
import { PERMISO_VENTAS_LEER } from "@/lib/services/ventas/presupuesto.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  COMPROBANTE_NO_ENCONTRADO: 404,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const GET = withPermission(
  PERMISO_VENTAS_LEER,
  async (_req: NextRequest, _session, rawContext) => {
    // Next.js 16: `params` es una Promise (se espera, no se asume shape).
    const { id } = await (rawContext as Context).params;

    const parsedId = ComprobanteFiscalIdSchema.safeParse(id);
    if (!parsedId.success) {
      return errorJson(
        "VALIDATION_ERROR",
        parsedId.error.issues[0]?.message ?? "Identificador inválido",
        400,
      );
    }

    try {
      const comprobante = await obtenerComprobantePorId(parsedId.data);
      return NextResponse.json({ data: comprobante, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      // Nunca se filtra el detalle de la DB ni el stack al cliente.
      console.error("[GET /api/ventas/comprobantes/[id]] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
