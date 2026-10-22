/**
 * @module route — GET /api/auditoria/mi-historial
 * @description HU-D8 — historial propio del usuario interno (spec_modulo_D.md
 * §8.1, `docs/modulos/modulo D/HU8_TASKS.md` T03).
 *
 * - Disponible para toda sesión interna (`withAuth`), sin permiso adicional
 *   (D8-5). Sin sesión interna → 401; la cookie de la tienda
 *   (`swat_tienda_session`) nunca resuelve sesión interna, así que una cuenta
 *   de cliente también recibe 401 (decisión C2).
 * - El usuario sale SIEMPRE de la sesión: `HistorialPropioFiltrosSchema` no
 *   declara `usuario_id`, así que si llega se descarta sin validarse (D8-1).
 * - `acciones_disponibles`: DISTINCT de acciones del propio usuario (D8-4).
 * - Solo lectura: no escribe en `AuditLog` ni emite eventos.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { HistorialPropioFiltrosSchema } from "@/lib/schemas/auditoria.schema";
import { listarAccionesPropias, listarHistorialPropio } from "@/lib/services/auditoria/audit-log.service";
import { ServiceError } from "@/lib/errors/service-error";

export const GET = withAuth(async (req: NextRequest, session) => {
  const parsed = HistorialPropioFiltrosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Los filtros enviados no son válidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const [listado, accionesDisponibles] = await Promise.all([
      listarHistorialPropio(parsed.data, session.userId),
      listarAccionesPropias(session.userId),
    ]);
    return NextResponse.json(
      { data: { ...listado, acciones_disponibles: accionesDisponibles }, error: null },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ServiceError && err.code === "VALIDATION_ERROR") {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: err.message } },
        { status: 400 },
      );
    }
    console.error("[GET /api/auditoria/mi-historial] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
