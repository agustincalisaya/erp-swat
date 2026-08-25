import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { confirmarRecepcionTransferencia } from "@/lib/services/inventario/transferencia.service";
import { ServiceError } from "@/lib/errors/service-error";
import { TransferenciaIdSchema } from "@/lib/schemas/inventario.schema";

type Context = { params: Promise<{ id: string }> };
export const POST = withPermission("inventario:confirmar_recepcion", async (_req: NextRequest, session, rawContext) => {
  const { id } = await (rawContext as Context).params;
  const parsedId = TransferenciaIdSchema.safeParse(id);
  if (!parsedId.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } }, { status: 400 });
  try {
    return NextResponse.json({ data: await confirmarRecepcionTransferencia(parsedId.data, session.userId), error: null });
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: ["TRANSFERENCIA_YA_RECIBIDA", "STOCK_DESTINO_INACTIVO"].includes(error.code) ? 409 : 404 });
    console.error("[confirmar transferencia]", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } }, { status: 500 });
  }
});
