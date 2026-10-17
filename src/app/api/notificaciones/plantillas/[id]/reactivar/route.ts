/**
 * @module route — PATCH /api/notificaciones/plantillas/[id]/reactivar
 * @description HU-F2 (task §4.1-bis, PROPUESTA aprobada: el spec F §2.2 dice
 * que una plantilla dada de baja "se reactiva y edita" pero no define el
 * endpoint). Wrapper fino (spec F §1): resuelve sesión + permiso, valida el id
 * con Zod y delega en `reactivarPlantillaNotificacion()`. Sin body.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PLANTILLA_NO_ENCONTRADA · 409 PLANTILLA_YA_ACTIVA ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { PlantillaNotificacionIdSchema } from "@/lib/schemas/notificaciones.schema";
import {
  PERMISO_ADMINISTRAR_PLANTILLAS,
  reactivarPlantillaNotificacion,
} from "@/lib/services/notificaciones/plantilla-notificacion.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PLANTILLA_NO_ENCONTRADA: 404,
  PLANTILLA_YA_ACTIVA: 409,
};

export const PATCH = withPermission(
  PERMISO_ADMINISTRAR_PLANTILLAS,
  async (_req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = PlantillaNotificacionIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsedId.error.issues[0]?.message ?? "ID inválido",
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await reactivarPlantillaNotificacion(parsedId.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (error) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status: STATUS_POR_CODIGO[error.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/notificaciones/plantillas/[id]/reactivar] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
