import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ValidarRetiroSchema } from "@/lib/schemas/retiro-e3.schema";
import { RetiroRechazadoError, validarYEntregarRetiro } from "@/lib/services/ecommerce/retiro-e3.service";

const protegido = withPermission("ecommerce:validar_retiro_qr", async (req: NextRequest, session) => {
  const body: unknown = await req.json().catch(() => null);
  const parsed = ValidarRetiroSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Datos de retiro inválidos" } },
      { status: 400 },
    );
  }

  try {
    const retiro = await validarYEntregarRetiro(parsed.data, session.userId);
    return NextResponse.json({
      data: { pedido_venta_id: retiro.pedido_venta_id, numero: retiro.numero_venta, estado: "ENTREGADO" },
      error: null,
    });
  } catch (error) {
    if (error instanceof RetiroRechazadoError) {
      return NextResponse.json(
        { data: null, error: { code: "RETIRO_NO_VALIDO", message: "No fue posible validar el retiro" } },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
      { status: 500 },
    );
  }
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // withPermission produce también las respuestas 401/403: todas deben impedir caché.
  try {
    const response = await protegido(req, undefined);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
