/**
 * @module route — PATCH /api/notificaciones/plantillas/[id]/baja
 * @description HU-F2 (spec_modulo_F.md §2.2, task §4.3) — Baja lógica de una
 * PlantillaNotificacion. Wrapper fino (spec F §1): resuelve sesión + permiso,
 * valida id + `deletion_reason` con Zod y delega en
 * `darDeBajaPlantillaNotificacion()`.
 *
 * El verbo es PATCH (no DELETE): es una baja lógica, la fila se conserva
 * (RULES.md Regla N.° 1).
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PLANTILLA_NO_ENCONTRADA · 409 PLANTILLA_YA_DADA_DE_BAJA ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  DarDeBajaPlantillaNotificacionSchema,
  PlantillaNotificacionIdSchema,
} from "@/lib/schemas/notificaciones.schema";
import {
  darDeBajaPlantillaNotificacion,
  PERMISO_ADMINISTRAR_PLANTILLAS,
} from "@/lib/services/notificaciones/plantilla-notificacion.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PLANTILLA_NO_ENCONTRADA: 404,
  PLANTILLA_YA_DADA_DE_BAJA: 409,
};

export const PATCH = withPermission(
  PERMISO_ADMINISTRAR_PLANTILLAS,
  async (req: NextRequest, session, rawContext) => {
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

    const body = await req.json().catch(() => null);
    const parsed = DarDeBajaPlantillaNotificacionSchema.safeParse(body);
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
      const resultado = await darDeBajaPlantillaNotificacion(
        parsedId.data,
        parsed.data,
        session.userId,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (error) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status: STATUS_POR_CODIGO[error.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/notificaciones/plantillas/[id]/baja] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
