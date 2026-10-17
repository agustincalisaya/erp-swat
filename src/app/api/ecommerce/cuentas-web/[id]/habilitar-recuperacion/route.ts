import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { habilitarRecuperacionCuentaWeb } from "@/lib/services/ecommerce/cuenta-cliente-web.service";
import { PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB } from "@/lib/auth/permisos-ecommerce";

type Contexto = { params: Promise<{ id: string }> };
export const POST = withPermission(PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB, async (_req: NextRequest, session, context) => {
  const { id } = await (context as Contexto).params;
  try { return NextResponse.json({ data: await habilitarRecuperacionCuentaWeb(id, session.userId), error: null }, { status: 201 }); }
  catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.code === "CUENTA_VINCULACION_PENDIENTE" ? 409 : 404 });
    console.error("[POST habilitar-recuperacion] Error inesperado:", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
  }
});
