/**
 * @module route — GET /api/notificaciones
 * @description HU-F3 (spec_modulo_F.md §2.3, task §4.2) — Bandeja de
 * notificaciones del personal interno. Wrapper fino: `withAuth` (sesión RBAC
 * válida, sin permiso granular — la autorización es por propiedad del
 * recurso), Zod sobre el query y delega en `listarNotificaciones()`.
 *
 * El destinatario sale SIEMPRE de la sesión; el query no admite identificar
 * a otro usuario. La campana del header consulta este endpoint con
 * `?solo_no_leidas=true&page_size=1` (polling) para leer `no_leidas`.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ListarNotificacionesQuerySchema } from "@/lib/schemas/notificaciones.schema";
import { listarNotificaciones } from "@/lib/services/notificaciones/notificacion.service";

export const GET = withAuth(async (req: NextRequest, session) => {
  const parsed = ListarNotificacionesQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Parámetros inválidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const data = await listarNotificaciones(
      { tipo: "USUARIO", usuario_id: session.userId },
      parsed.data,
    );
    return NextResponse.json({ data, error: null }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/notificaciones] Error inesperado:", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
