/**
 * @module route — POST /api/ecommerce/auditoria/pagos/solicitar-acceso
 * @description HU-E6 (spec_modulo_E.md §2.6, R4) — el Administrador E-commerce
 * solicita acceso al log de pagos. Wrapper fino: `withPermission` +
 * validación Zod del body + service. El solicitante sale SIEMPRE de la sesión.
 *
 * Respuestas: 201 CREATED · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { SolicitarAccesoLogPagosSchema } from "@/lib/schemas/ecommerce.schema";
import {
  PERMISO_SOLICITAR_ACCESO_LOG_PAGOS,
  solicitarAccesoLogPagos,
} from "@/lib/services/ecommerce/auditoria-pagos.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  CONFIGURACION_INVALIDA: 400,
};

export const POST = withPermission(
  PERMISO_SOLICITAR_ACCESO_LOG_PAGOS,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = SolicitarAccesoLogPagosSchema.safeParse(body ?? {});
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
      const data = await solicitarAccesoLogPagos(session.userId, parsed.data.motivo);
      return NextResponse.json({ data: { id: data.id }, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/ecommerce/auditoria/pagos/solicitar-acceso] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
