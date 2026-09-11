/**
 * @module route — POST /api/auth/logout
 * @description HU-3 — Logout real (task_cali_hu3_login.md §3.2). Reemplaza
 * el stub 501 anterior. Idempotente: sin sesión o con un JWT ya inválido,
 * responde 200 igual — logout nunca falla.
 */
import { NextRequest, NextResponse } from "next/server";
import { verificarSesionJwt } from "@/lib/auth/jwt";
import { cerrarSesion } from "@/lib/services/auditoria/sesion.service";
import { SESION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESION_COOKIE_NAME)?.value;

  if (token) {
    const jwtPayload = await verificarSesionJwt(token);
    if (jwtPayload) {
      await cerrarSesion(jwtPayload.jti);
    }
  }

  const response = NextResponse.json(
    { data: { mensaje: "Sesión cerrada" }, error: null },
    { status: 200 },
  );

  response.cookies.delete(SESION_COOKIE_NAME);

  return response;
}
