import { NextRequest, NextResponse } from "next/server";
import { withAuth, withPermission, usuarioTienePermiso } from "@/lib/auth/with-permission";
import { CrearCategoriaGastoSchema } from "@/lib/schemas/categoria-gasto.schema";
import {
  crearCategoriaGasto, listarCategoriasGasto, listarCategoriasActivasParaGasto,
  PERMISO_GESTIONAR_CATEGORIAS_GASTO, PERMISO_GESTIONAR_GASTOS,
} from "@/lib/services/tesoreria/categoria-gasto.service";
import { errorCategoriaGasto, validacionCategoriaGasto } from "./respuesta";

export const GET = withAuth(async (req: NextRequest, session) => {
  const selector = req.nextUrl.searchParams.get("selector") === "1";
  const permiso = selector ? PERMISO_GESTIONAR_GASTOS : PERMISO_GESTIONAR_CATEGORIAS_GASTO;
  if (!(await usuarioTienePermiso(session.userId, permiso))) {
    return NextResponse.json({ data: null, error: { code: "FORBIDDEN", message: "Acceso denegado" } }, { status: 403 });
  }
  try {
    const data = selector
      ? await listarCategoriasActivasParaGasto()
      : await listarCategoriasGasto(req.nextUrl.searchParams.get("incluir_inactivas") === "1");
    return NextResponse.json({ data, error: null });
  } catch (error) { return errorCategoriaGasto(error, "GET categorías"); }
});

export const POST = withPermission(PERMISO_GESTIONAR_CATEGORIAS_GASTO, async (req: NextRequest, session) => {
  const parsed = CrearCategoriaGastoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validacionCategoriaGasto(parsed.error.issues[0]?.message ?? "Datos inválidos");
  try {
    const data = await crearCategoriaGasto(parsed.data, session.userId);
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) { return errorCategoriaGasto(error, "POST categoría"); }
});
