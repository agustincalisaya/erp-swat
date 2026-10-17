/**
 * @module route — PATCH /api/notificaciones/[id]/archivar
 * @description HU-F3 (spec_modulo_F.md §2.3, task §4.5) — Archiva una
 * notificación propia: baja lógica del lado del destinatario (`is_active`,
 * `deleted_at`, `deleted_by`; sin `deletion_reason`, RULES.md Regla N.° 1).
 * El verbo es PATCH, no DELETE. Idempotente: repetir devuelve 200.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 404 NOTIFICACION_NO_ENCONTRADA (inexistente o ajena) · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { NotificacionIdSchema } from "@/lib/schemas/notificaciones.schema";
import { archivarNotificacion } from "@/lib/services/notificaciones/notificacion.service";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (_req: NextRequest, session, rawContext) => {
  const { id } = await (rawContext as Context).params;
  const parsedId = NotificacionIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message ?? "ID inválido" },
      },
      { status: 400 },
    );
  }

  try {
    const data = await archivarNotificacion(parsedId.data, {
      tipo: "USUARIO",
      usuario_id: session.userId,
    });
    return NextResponse.json({ data, error: null }, { status: 200 });
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOTIFICACION_NO_ENCONTRADA") {
      return NextResponse.json(
        { data: null, error: { code: error.code, message: error.message } },
        { status: 404 },
      );
    }
    console.error("[PATCH /api/notificaciones/[id]/archivar] Error inesperado:", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
