/**
 * @module route — PATCH /api/auth/roles/[id]/permisos
 * @description Endpoint 2.2.6 — Actualizar permisos de un Rol
 * (spec_modulo_D.md §2.2.6, task_cali_roles_permisos.md §3.2).
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ActualizarPermisosRolSchema } from "@/lib/schemas/auditoria.schema";
import { actualizarPermisosRol } from "@/lib/services/auditoria/rol.service";
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
  const rolId = pathname.split("/").slice(-2, -1)[0];

  const body = await req.json().catch(() => ({}));
  const parsed = ActualizarPermisosRolSchema.safeParse({ ...(body ?? {}), rol_id: rolId });

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
    const resultado = await actualizarPermisosRol(parsed.data, session.userId, ip);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status =
        err.code === "ROL_NO_ENCONTRADO"
          ? 404
          : err.code === "SISTEMA_SIN_ADMINISTRADOR"
            ? 409
            : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[PATCH /api/auth/roles/[id]/permisos] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
