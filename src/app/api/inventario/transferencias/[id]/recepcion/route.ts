import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { confirmarRecepcionTransferencia } from "@/lib/services/inventario/transferencia.service";
import { ServiceError } from "@/lib/errors/service-error";
import { TransferenciaIdSchema, ConfirmarRecepcionTransferenciaBodySchema } from "@/lib/schemas/inventario.schema";

type Context = { params: Promise<{ id: string }> };
/** HU-A11 — body: `{ items: { transferencia_item_id, cantidad_recibida }[] }` (recepción total o parcial). */
export const POST = withPermission("inventario:confirmar_recepcion", async (req: NextRequest, session, rawContext) => {
  const { id } = await (rawContext as Context).params;
  const parsedId = TransferenciaIdSchema.safeParse(id);
  if (!parsedId.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } }, { status: 400 });
  const parsedBody = ConfirmarRecepcionTransferenciaBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: parsedBody.error.issues[0]?.message, details: parsedBody.error.flatten() } }, { status: 400 });
  try {
    const data = await confirmarRecepcionTransferencia(
      { transferencia_id: parsedId.data, items: parsedBody.data.items },
      session.userId,
    );
    return NextResponse.json({ data, error: null });
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: ["TRANSFERENCIA_YA_RECIBIDA", "STOCK_DESTINO_INACTIVO", "ITEM_RECEPCION_CONCURRENTE", "CANTIDAD_EXCEDE_PENDIENTE"].includes(error.code) ? 409 : 404 });
    console.error("[confirmar transferencia]", error);
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } }, { status: 500 });
  }
});
