import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearTransferenciaSchema } from "@/lib/schemas/inventario.schema";
import { crearTransferencia } from "@/lib/services/inventario/transferencia.service";
import { ServiceError } from "@/lib/errors/service-error";

export const POST = withPermission("inventario:transferir_stock", async (req: NextRequest, session) => {
  const parsed = CrearTransferenciaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message, details: parsed.error.flatten() } }, { status: 400 });
  try {
    return NextResponse.json({ data: await crearTransferencia(parsed.data, session.userId), error: null }, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.code === "STOCK_INSUFICIENTE" ? 422 : 404 });
    console.error("[crear transferencia]", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } }, { status: 500 });
  }
});
