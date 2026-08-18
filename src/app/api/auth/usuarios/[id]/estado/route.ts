/**
 * @module route — PATCH /api/auth/usuarios/[id]/estado
 * @description Endpoint 2.2.3 — Cambio de Estado Manual de Usuario
 * (spec_modulo_D.md §2.2.3, ajustado por task_cali_estado_usuario.md).
 *
 * Gateado por `roles:administrar` (Camino A, task_cali_roles_permisos.md,
 * ronda de corrección posterior al cierre de la tarea de Roles/Permisos):
 * hasta esta corrección, este endpoint solo exigía `withAuth` (sesión
 * válida) — CUALQUIER usuario autenticado, sin ningún permiso, podía
 * suspender/bloquear a cualquier otro usuario, incluido el único
 * Administrador del sistema. Se reutiliza el mismo permiso ya usado para
 * gestión de roles/permisos (no se crea uno separado `usuarios:administrar`)
 * por decisión explícita del equipo.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CambiarEstadoUsuarioSchema } from "@/lib/schemas/auditoria.schema";
import { cambiarEstadoUsuario } from "@/lib/services/auditoria/usuario.service";
import { ServiceError } from "@/lib/errors/service-error";

function resolverIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export const PATCH = withPermission("roles:administrar", async (req: NextRequest, session) => {
  const { pathname } = req.nextUrl;
  const usuarioId = pathname.split("/").slice(-2, -1)[0];

  const body = await req.json().catch(() => ({}));
  const parsed = CambiarEstadoUsuarioSchema.safeParse({ ...(body ?? {}), usuario_id: usuarioId });

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Los datos enviados no son válidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const ip = resolverIp(req);

  try {
    const resultado = await cambiarEstadoUsuario(parsed.data, session.userId, ip);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status =
        err.code === "USUARIO_NO_ENCONTRADO"
          ? 404
          : err.code === "SISTEMA_SIN_ADMINISTRADOR"
            ? 409
            : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[PATCH /api/auth/usuarios/[id]/estado] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
