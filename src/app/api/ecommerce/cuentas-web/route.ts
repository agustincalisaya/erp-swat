import { NextResponse, type NextRequest } from "next/server";
import { PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { BuscarCuentaPorDniSchema } from "@/lib/schemas/cuenta-cliente-web.schema";
import { buscarCuentaWebPorDni } from "@/lib/services/ecommerce/cuenta-cliente-web.service";

export const GET = withPermission(PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB, async (req: NextRequest) => {
  const input = BuscarCuentaPorDniSchema.safeParse({ dni: req.nextUrl.searchParams.get("dni") });
  if (!input.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: "DNI inválido", fieldErrors: input.error.flatten().fieldErrors } }, { status: 400 });
  const cuenta = await buscarCuentaWebPorDni(input.data.dni);
  if (!cuenta) return NextResponse.json({ data: null, error: { code: "CUENTA_WEB_NO_ENCONTRADA", message: "Cuenta web no encontrada" } }, { status: 404 });
  return NextResponse.json({ data: { cuenta }, error: null });
});
