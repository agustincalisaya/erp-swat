/**
 * @module route — GET /api/ecommerce/auditoria/pagos
 * @description HU-E6 (spec_modulo_E.md §2.6, R2) — log de auditoría de pagos
 * online. Wrapper fino: `withAuth` (el doble permiso Auditor / Administrador
 * E-commerce se resuelve en el servicio, que lanza los códigos específicos),
 * valida el query con `ListarLogPagosQuerySchema` y delega en
 * `obtenerLogPagos()`. NINGUNA regla de negocio vive acá.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 403 ACCESO_LOG_PAGOS_NO_APROBADO · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ListarLogPagosQuerySchema } from "@/lib/schemas/ecommerce.schema";
import { obtenerLogPagos } from "@/lib/services/ecommerce/auditoria-pagos.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  FORBIDDEN: 403,
  ACCESO_LOG_PAGOS_NO_APROBADO: 403,
};

export const GET = withAuth(async (req: NextRequest, session) => {
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ListarLogPagosQuerySchema.safeParse(queryParams);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Los filtros enviados no son válidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await obtenerLogPagos(parsed.data, session);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status: STATUS_POR_CODIGO[err.code] ?? 400 },
      );
    }
    console.error("[GET /api/ecommerce/auditoria/pagos] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
