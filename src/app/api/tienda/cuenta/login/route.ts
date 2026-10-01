/**
 * @module route — POST /api/tienda/cuenta/login
 * @description HU-E8 (spec_modulo_E.md §2.8) — login de Cliente Web.
 *
 * TODO(HU-E8): wrapper provisional introducido por HU-E1. Toda la lógica de
 * sesión vive en `lib/auth/sesion-cliente-web.ts` (reemplazable por el owner
 * de HU-E8 sin tocar E1).
 */
import { NextRequest, NextResponse } from "next/server";
import { IniciarSesionClienteWebSchema } from "@/lib/schemas/ecommerce.schema";
import {
  aplicarCookieSesionClienteWeb,
  iniciarSesionClienteWeb,
} from "@/lib/auth/sesion-cliente-web";
import { ServiceError } from "@/lib/errors/service-error";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = IniciarSesionClienteWebSchema.safeParse(body);
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

  try {
    const { sesion, jwt } = await iniciarSesionClienteWeb(parsed.data.email, parsed.data.password);

    const response = NextResponse.json(
      {
        data: {
          cuenta_id: sesion.cuentaId,
          email: sesion.email,
          vinculacion_pendiente: sesion.vinculacionPendiente,
        },
        error: null,
      },
      { status: 200 },
    );
    aplicarCookieSesionClienteWeb(response, jwt);
    return response;
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "CUENTA_BLOQUEADA" ? 423 : 401;
      return NextResponse.json({ data: null, error: { code: err.code, message: err.message } }, { status });
    }
    console.error("[POST /api/tienda/cuenta/login] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
}
