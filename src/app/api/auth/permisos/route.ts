/**
 * @module route — GET /api/auth/permisos
 * @description Listado de `Permiso` activos, soporte de UI para el
 * selector múltiple de alta/edición de `Rol` (task_cali_roles_permisos.md §3.3).
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { listarPermisos } from "@/lib/services/auditoria/rol.service";

export const GET = withAuth(async () => {
  try {
    const permisos = await listarPermisos();
    return NextResponse.json({ data: permisos, error: null }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/auth/permisos] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
