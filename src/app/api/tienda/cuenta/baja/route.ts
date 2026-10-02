import { NextResponse } from "next/server";
import { borrarCookieSesionClienteWeb, withSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { ServiceError } from "@/lib/errors/service-error";
import { BajaCuentaWebSchema } from "@/lib/schemas/cuenta-cliente-web.schema";
import { darDeBajaCuentaWeb } from "@/lib/services/ecommerce/cuenta-cliente-web.service";

export const PATCH = withSesionClienteWeb(async (req, sesion) => {
  const input = BajaCuentaWebSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos", fieldErrors: input.error.flatten().fieldErrors } }, { status: 400 });
  try {
    const response = NextResponse.json({ data: await darDeBajaCuentaWeb(sesion.cuentaId, input.data), error: null });
    borrarCookieSesionClienteWeb(response);
    return response;
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: 404 });
    console.error("[PATCH /api/tienda/cuenta/baja] Error inesperado:", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
  }
});
