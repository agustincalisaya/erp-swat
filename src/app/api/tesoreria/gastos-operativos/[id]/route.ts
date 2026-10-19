import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { EditarGastoOperativoSchema, GastoOperativoIdSchema } from "@/lib/schemas/gasto-operativo.schema";
import { editarGastoOperativo, PERMISO_GESTIONAR_GASTOS } from "@/lib/services/tesoreria/gasto-operativo.service";
import { errorGasto, validacionGasto } from "../respuesta";

type Context = { params: Promise<{ id: string }> };
export const PATCH = withPermission(PERMISO_GESTIONAR_GASTOS, async (req: NextRequest, session, context) => {
  const id = GastoOperativoIdSchema.safeParse((await (context as Context).params).id);
  if (!id.success) return validacionGasto("ID inválido");
  const parsed = EditarGastoOperativoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validacionGasto(parsed.error.issues[0]?.message ?? "Datos inválidos");
  try { return NextResponse.json({ data: await editarGastoOperativo(id.data, parsed.data, session.userId), error: null }); }
  catch (error) { return errorGasto(error, "PATCH gasto"); }
});
