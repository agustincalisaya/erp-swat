/**
 * @module route — GET /api/ventas/auditoria
 * @description HU-B6 §2.6 — Log forense de Módulo B (anulaciones, descuentos
 * fuera de margen, cambios de precio y excepciones de crédito). Wrapper fino:
 * `withAuth` + resolución manual del nivel de acceso (`withPermission` solo
 * acepta UN código y acá alcanza con cualquiera de dos:
 * `auditoria:leer_forense` o `ventas:leer_log_operativo`), valida el query y
 * delega en `obtenerLogsVentas()`. El alcance (Auditor vs. Supervisor) y el
 * rechazo de `verificar_integridad` para el Supervisor viven en el servicio.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 403 VERIFICACION_INTEGRIDAD_NO_DISPONIBLE · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ConsultarAuditoriaVentasQuerySchema } from "@/lib/schemas/ventas.schema";
import {
  obtenerLogsVentas,
  resolverNivelAccesoAuditoriaVentas,
} from "@/lib/services/ventas/auditoria-ventas.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  FORBIDDEN: 403,
  VERIFICACION_INTEGRIDAD_NO_DISPONIBLE: 403,
};

export const GET = withAuth(async (req: NextRequest, session) => {
  const nivel = await resolverNivelAccesoAuditoriaVentas(session.userId);
  if (nivel === null) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta acción" },
      },
      { status: 403 },
    );
  }

  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ConsultarAuditoriaVentasQuerySchema.safeParse(queryParams);
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
    const resultado = await obtenerLogsVentas(parsed.data, session);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status: STATUS_POR_CODIGO[err.code] ?? 400 },
      );
    }
    console.error("[GET /api/ventas/auditoria] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
