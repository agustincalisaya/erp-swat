import { NextResponse, type NextRequest } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";
import { RegistroCuentaWebSchema } from "@/lib/schemas/cuenta-cliente-web.schema";
import { registrarCuentaClienteWeb } from "@/lib/services/ecommerce/cuenta-cliente-web.service";

export async function POST(req: NextRequest) {
  const input = RegistroCuentaWebSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos", fieldErrors: input.error.flatten().fieldErrors } }, { status: 400 });
  try { return NextResponse.json({ data: await registrarCuentaClienteWeb(input.data), error: null }, { status: 201 }); }
  catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.code.endsWith("YA_EXISTE") || error.code === "REGISTRO_WEB_NO_DISPONIBLE" ? 409 : 500 });
    console.error("[POST /api/tienda/cuenta/registro] Error inesperado:", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }, { status: 500 });
  }
}
