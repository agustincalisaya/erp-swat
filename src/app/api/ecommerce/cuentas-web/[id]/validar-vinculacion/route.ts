import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ValidarVinculacionSchema } from "@/lib/schemas/cuenta-cliente-web.schema";
import { validarVinculacionCuentaWeb } from "@/lib/services/ecommerce/cuenta-cliente-web.service";
import { PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB } from "@/lib/auth/permisos-ecommerce";

type Contexto = { params: Promise<{ id: string }> };
export const POST = withPermission(PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB, async (req: NextRequest, session, context) => {
  const input = ValidarVinculacionSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos", fieldErrors: input.error.flatten().fieldErrors } }, { status: 400 });
  const { id } = await (context as Contexto).params;
  try { return NextResponse.json({ data: await validarVinculacionCuentaWeb(id, session.userId, input.data), error: null }); }
  catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.code === "REGISTRO_WEB_NO_DISPONIBLE" ? 409 : 404 });
    console.error("[POST validar-vinculacion] Error inesperado:", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
  }
});
