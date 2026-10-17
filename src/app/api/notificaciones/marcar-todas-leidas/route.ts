/**
 * @module route — PATCH /api/notificaciones/marcar-todas-leidas
 * @description HU-F3 (spec_modulo_F.md §2.3, task §4.4) — Marca leídas todas
 * las notificaciones activas no leídas del usuario de la sesión. Sin body.
 * Shape de respuesta (task §8, Punto 8 — decidido): `{ actualizadas: n }`.
 *
 * Respuestas: 200 OK · 401 UNAUTHORIZED · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { marcarTodasLeidas } from "@/lib/services/notificaciones/notificacion.service";

export const PATCH = withAuth(async (_req: NextRequest, session) => {
  try {
    const data = await marcarTodasLeidas({ tipo: "USUARIO", usuario_id: session.userId });
    return NextResponse.json({ data, error: null }, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/notificaciones/marcar-todas-leidas] Error inesperado:", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
