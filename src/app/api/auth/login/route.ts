/**
 * @module route — POST /api/auth/login
 * @description HU-3 — Login real (task_cali_hu3_login.md §3.1). Reemplaza
 * el stub 501 anterior.
 */
import { NextRequest, NextResponse } from "next/server";
import { LoginSchema } from "@/lib/schemas/auth.schema";
import { iniciarSesion, DURACION_SESION_HORAS } from "@/lib/services/auditoria/sesion.service";
import { SESION_COOKIE_NAME } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";

function resolverIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);

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
  const userAgent = req.headers.get("user-agent");

  try {
    const resultado = await iniciarSesion(parsed.data, ip, userAgent);

    const response = NextResponse.json(
      {
        data: {
          usuario_id: resultado.usuario.usuario_id,
          nombre_completo: resultado.usuario.nombre_completo,
          roles: resultado.usuario.roles,
        },
        error: null,
      },
      { status: 200 },
    );

    // El JWT NUNCA va en el body — solo en la cookie httpOnly (spec §3.1).
    response.cookies.set(SESION_COOKIE_NAME, resultado.jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: DURACION_SESION_HORAS * 60 * 60,
      path: "/",
    });

    return response;
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "CUENTA_SUSPENDIDA" ? 403 : 401;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[POST /api/auth/login] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
}
