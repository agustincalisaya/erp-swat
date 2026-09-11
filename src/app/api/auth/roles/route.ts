/**
 * @module route — POST/GET /api/auth/roles
 * @description Endpoint 2.2.5 — Alta de Rol (spec_modulo_D.md §2.2.5,
 * task_cali_roles_permisos.md §3.1) y listado de soporte de UI (§3.3).
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth, withPermission } from "@/lib/auth/with-permission";
import { CrearRolSchema } from "@/lib/schemas/auditoria.schema";
import { crearRol, listarRoles } from "@/lib/services/auditoria/rol.service";
import { ServiceError } from "@/lib/errors/service-error";

function resolverIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export const POST = withPermission("roles:administrar", async (req: NextRequest, session) => {
  const body = await req.json().catch(() => null);
  const parsed = CrearRolSchema.safeParse(body);

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
    const resultado = await crearRol(parsed.data, session.userId, ip);
    return NextResponse.json({ data: resultado, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "ROL_DUPLICADO" ? 409 : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[POST /api/auth/roles] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});

export const GET = withAuth(async (req: NextRequest) => {
  const incluirPermisos = req.nextUrl.searchParams.get("incluir_permisos") === "true";

  try {
    const roles = await listarRoles(incluirPermisos);
    return NextResponse.json({ data: roles, error: null }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/auth/roles] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
