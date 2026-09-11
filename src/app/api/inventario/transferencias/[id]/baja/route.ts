import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { BajaTransferenciaSchema, TransferenciaIdSchema } from "@/lib/schemas/inventario.schema";
import { darDeBajaTransferencia } from "@/lib/services/inventario/transferencia.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };
export const PATCH = withPermission("inventario:transferir_stock", async (req: NextRequest, session, rawContext) => {
  const parsed = BajaTransferenciaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } }, { status: 400 });
  const { id } = await (rawContext as Context).params;
  const parsedId = TransferenciaIdSchema.safeParse(id);
  if (!parsedId.success) return NextResponse.json({ data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } }, { status: 400 });
  try {
    return NextResponse.json({ data: await darDeBajaTransferencia(parsedId.data, session.userId, parsed.data.deletion_reason), error: null });
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.code === "TRANSFERENCIA_EN_TRANSITO" ? 409 : 404 });
    return NextResponse.json({ data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } }, { status: 500 });
  }
});
