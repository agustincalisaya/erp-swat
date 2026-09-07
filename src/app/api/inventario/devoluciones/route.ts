/**
 * @module route — GET /api/inventario/devoluciones
 * @description HU-A9 (spec_modulo_A.md §2.8) — Listado de unidades en estado
 * `DEVUELTO` para la UI de devoluciones. Filtros opcionales por
 * `variante_sku_id` y `deposito_id` (query params), sin paginación. El
 * depósito se resuelve desde la cabecera del movimiento (no existe estado
 * desnormalizado en `StockDeposito`).
 *
 * Gateado con `withPermission("inventario:reclasificar")` (ADMINISTRADOR +
 * ENCARGADO_DEPOSITO).
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ListarUnidadesDevueltasQuerySchema } from "@/lib/schemas/inventario.schema";
import { listarUnidadesDevueltas } from "@/lib/services/inventario/reclasificacion.service";

export const GET = withPermission("inventario:reclasificar", async (req: NextRequest) => {
  const parsed = ListarUnidadesDevueltasQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Filtros inválidos",
        },
      },
      { status: 400 },
    );
  }

  try {
    const unidades = await listarUnidadesDevueltas(parsed.data);
    return NextResponse.json({ data: unidades, error: null }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/inventario/devoluciones] Error inesperado:", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});