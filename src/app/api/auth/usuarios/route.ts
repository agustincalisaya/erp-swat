/**
 * @module route — POST /api/auth/usuarios
 * @description HU-1 — Alta de Usuario y Roles (spec_modulo_D.md §2.2.1).
 * Ruta bajo `api/auth/` por convención: gestión de identidad, no de auditoría.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { CrearUsuarioSchema } from "@/lib/schemas/auditoria.schema";
import { crearUsuario } from "@/lib/services/auditoria/usuario.service";
import { ServiceError } from "@/lib/errors/service-error";

function resolverIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export const POST = withAuth(async (req: NextRequest, session) => {
  const body = await req.json().catch(() => null);
  const parsed = CrearUsuarioSchema.safeParse(body);

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
    const resultado = await crearUsuario(parsed.data, session.userId, ip);
    return NextResponse.json({ data: resultado, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "USUARIO_DUPLICADO" ? 409 : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[POST /api/auth/usuarios] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
