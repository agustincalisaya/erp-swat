/**
 * @module route — PATCH /api/auth/usuarios/[id]/reactivar
 * @description Reactivación de Usuario INACTIVO (task_cali_filtro_reactivacion.md §2.2).
 * Deliberadamente separado de `PATCH /api/auth/usuarios/[id]/estado` (Endpoint
 * 2.2.3): reactivar una baja lógica es una decisión de mayor peso que
 * levantar una suspensión temporal — no reusar ese endpoint para esto.
 *
 * Gateado por `roles:administrar` (mismo permiso que `baja/route.ts` y
 * `estado/route.ts`, decisión ya tomada en task_cali_roles_permisos.md — no
 * se crea un permiso separado `usuarios:administrar`).
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ReactivarUsuarioSchema } from "@/lib/schemas/auditoria.schema";
import { reactivarUsuario } from "@/lib/services/auditoria/usuario.service";
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
  const parsed = ReactivarUsuarioSchema.safeParse({ ...(body ?? {}), usuario_id: usuarioId });

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "MOTIVO_REQUERIDO",
          message: "El motivo de reactivación es obligatorio",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const ip = resolverIp(req);

  try {
    const resultado = await reactivarUsuario(parsed.data, session.userId, ip);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status =
        err.code === "USUARIO_NO_ENCONTRADO"
          ? 404
          : err.code === "USUARIO_NO_INACTIVO"
            ? 409
            : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[PATCH /api/auth/usuarios/[id]/reactivar] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
