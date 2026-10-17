/**
 * @module route — GET /api/inventario/variantes/[id]/stock-por-deposito
 * @description Mejora UX — stock disponible por depósito en alta de
 * Presupuesto (HU-B3, task_mejora_ux_stock_deposito_presupuesto.md).
 *
 * Capa delgada: valida el segmento `[id]` con
 * `ObtenerStockPorVarianteParamsSchema` y delega TODA la lógica de query en
 * `obtenerStockPorVarianteYDepositos()` de `stock.service.ts`. Ninguna
 * llamada a Prisma vive en este archivo — mismo molde que
 * `depositos/[id]/productos/route.ts`.
 *
 * Gateado con `withAuth` (solo sesión), sin `withPermission` granular —
 * mismo criterio que el resto de los Route Handlers de consulta de solo
 * lectura de Módulo A (ver docstring de `depositos/[id]/productos/route.ts`):
 * no existe un permiso RBAC de lectura de inventario en `prisma/seed.ts`.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR (Zod) · 401
 * UNAUTHORIZED · 404 VARIANTE_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ObtenerStockPorVarianteParamsSchema } from "@/lib/schemas/inventario.schema";
import { obtenerStockPorVarianteYDepositos } from "@/lib/services/inventario/stock.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

export const GET = withAuth(async (_req: NextRequest, _session, rawContext) => {
  const { id } = await (rawContext as Context).params;

  const parsed = ObtenerStockPorVarianteParamsSchema.safeParse({ variante_sku_id: id });

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Parámetros de consulta inválidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await obtenerStockPorVarianteYDepositos(parsed.data.variante_sku_id);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "VARIANTE_NO_ENCONTRADA" ? 404 : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[GET /api/inventario/variantes/[id]/stock-por-deposito] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
