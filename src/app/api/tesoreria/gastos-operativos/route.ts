import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearGastoOperativoSchema, ListarGastosOperativosSchema } from "@/lib/schemas/gasto-operativo.schema";
import { crearGastoOperativo, listarGastosOperativos, PERMISO_GESTIONAR_GASTOS } from "@/lib/services/tesoreria/gasto-operativo.service";
import { errorGasto, validacionGasto } from "./respuesta";

export const GET = withPermission(PERMISO_GESTIONAR_GASTOS, async (req: NextRequest) => {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = ListarGastosOperativosSchema.safeParse(params);
  if (!parsed.success) return validacionGasto(parsed.error.issues[0]?.message ?? "Filtros inválidos");
  try { return NextResponse.json({ data: await listarGastosOperativos(parsed.data), error: null }); }
  catch (error) { return errorGasto(error, "GET gastos"); }
});
export const POST = withPermission(PERMISO_GESTIONAR_GASTOS, async (req: NextRequest, session) => {
  const parsed = CrearGastoOperativoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validacionGasto(parsed.error.issues[0]?.message ?? "Datos inválidos");
  try { return NextResponse.json({ data: await crearGastoOperativo(parsed.data, session.userId), error: null }, { status: 201 }); }
  catch (error) { return errorGasto(error, "POST gasto"); }
});
