/**
 * @module route — PATCH /api/notificaciones/plantillas/[id]
 * @description HU-F2 (spec_modulo_F.md §2.2, task §4.2) — Edición de la
 * redacción de una PlantillaNotificacion activa. Wrapper fino (spec F §1):
 * resuelve sesión + permiso, valida id y body con Zod y delega en
 * `editarPlantillaNotificacion()`.
 *
 * `tipo_evento` es inmutable: si viene en el body, `.strict()` lo rechaza y se
 * responde `400 CAMPO_INMUTABLE` con el mensaje de Zod (spec §2.2). Body vacío
 * `{}` → `400 VALIDATION_ERROR` (task §8, Punto abierto 8).
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 400 CAMPO_INMUTABLE ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 PLANTILLA_NO_ENCONTRADA ·
 * 409 PLANTILLA_DADA_DE_BAJA · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  EditarPlantillaNotificacionBodySchema,
  errorEdicion,
  PlantillaNotificacionIdSchema,
} from "@/lib/schemas/notificaciones.schema";
import {
  editarPlantillaNotificacion,
  PERMISO_ADMINISTRAR_PLANTILLAS,
} from "@/lib/services/notificaciones/plantilla-notificacion.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PLANTILLA_NO_ENCONTRADA: 404,
  PLANTILLA_DADA_DE_BAJA: 409,
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
    const parsed = EditarPlantillaNotificacionBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: errorEdicion(parsed.error) },
        { status: 400 },
      );
    }

    try {
      const resultado = await editarPlantillaNotificacion(
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
      console.error("[PATCH /api/notificaciones/plantillas/[id]] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
