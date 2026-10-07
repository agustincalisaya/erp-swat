/**
 * @module route — PATCH /api/ecommerce/auditoria/pagos/solicitar-acceso/[id]
 * @description HU-E6 (spec_modulo_E.md §2.6, R4) — el Auditor aprueba la
 * solicitud de acceso del Administrador E-commerce. Wrapper fino:
 * `withPermission("auditoria:leer_forense")` + validación del `[id]` + service.
 * El service fija `estado=APROBADO`, `aprobador_id` y
 * `expira_en = now + N días` (config del sistema).
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 SOLICITUD_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { AccesoLogPagosIdSchema } from "@/lib/schemas/ecommerce.schema";
import {
  aprobarAccesoLogPagos,
  PERMISO_AUDITORIA_LEER_FORENSE,
} from "@/lib/services/ecommerce/auditoria-pagos.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  SOLICITUD_NO_ENCONTRADA: 404,
  CONFIGURACION_INVALIDA: 400,
};

export const PATCH = withPermission(
  PERMISO_AUDITORIA_LEER_FORENSE,
  async (_req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = AccesoLogPagosIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    try {
      const data = await aprobarAccesoLogPagos(parsedId.data, session.userId);
      return NextResponse.json({ data, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/ecommerce/auditoria/pagos/solicitar-acceso/[id]] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
