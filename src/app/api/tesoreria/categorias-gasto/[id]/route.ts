import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CategoriaGastoIdSchema, EditarCategoriaGastoSchema } from "@/lib/schemas/categoria-gasto.schema";
import { editarCategoriaGasto, PERMISO_GESTIONAR_CATEGORIAS_GASTO } from "@/lib/services/tesoreria/categoria-gasto.service";
import { errorCategoriaGasto, validacionCategoriaGasto } from "../respuesta";

type Context = { params: Promise<{ id: string }> };
export const PATCH = withPermission(PERMISO_GESTIONAR_CATEGORIAS_GASTO, async (req: NextRequest, session, rawContext) => {
  const id = CategoriaGastoIdSchema.safeParse((await (rawContext as Context).params).id);
  if (!id.success) return validacionCategoriaGasto(id.error.issues[0]?.message ?? "ID inválido");
  const parsed = EditarCategoriaGastoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validacionCategoriaGasto(parsed.error.issues[0]?.message ?? "Datos inválidos");
  try {
    const data = await editarCategoriaGasto(id.data, parsed.data, session.userId);
    return NextResponse.json({ data, error: null });
  } catch (error) { return errorCategoriaGasto(error, "PATCH categoría"); }
});
