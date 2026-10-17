import { NextResponse, type NextRequest } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";
import { RedefinirPasswordSchema } from "@/lib/schemas/cuenta-cliente-web.schema";
import { ErrorConfiguracionCuentaWeb, MENSAJE_ERROR_INTERNO_CUENTA_WEB, redefinirPasswordCuentaWeb } from "@/lib/services/ecommerce/cuenta-cliente-web.service";

export async function POST(req: NextRequest) {
  const input = RedefinirPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos", fieldErrors: input.error.flatten().fieldErrors } }, { status: 400 });
  try { return NextResponse.json({ data: await redefinirPasswordCuentaWeb(input.data), error: null }); }
  catch (error) {
    if (error instanceof ErrorConfiguracionCuentaWeb) {
      console.error("[POST /api/tienda/cuenta/redefinir-password] Configuración inválida:", error);
      return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: MENSAJE_ERROR_INTERNO_CUENTA_WEB } }, { status: 500 });
    }
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.code === "CUENTA_BLOQUEADA" ? 423 : 422 });
    console.error("[POST /api/tienda/cuenta/redefinir-password] Error inesperado:", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
  }
}
