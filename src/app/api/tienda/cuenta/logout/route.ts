/**
 * @module route — POST /api/tienda/cuenta/logout
 * @description HU-E8 (spec_modulo_E.md §2.8) — cierre de sesión de Cliente Web.
 *
 * TODO(HU-E8): wrapper provisional introducido por HU-E1. Solo borra la
 * cookie; revocar sesiones ya emitidas es incrementar `token_version` (HU-E8).
 * El carrito persistente queda asociado a la cuenta (HU-E1 CA7).
 */
import { NextResponse } from "next/server";
import { borrarCookieSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";

export async function POST() {
  const response = NextResponse.json({ data: { sesion_cerrada: true }, error: null }, { status: 200 });
  borrarCookieSesionClienteWeb(response);
  return response;
}
