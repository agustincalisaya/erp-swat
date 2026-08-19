/**
 * @module route — PATCH /api/inventario/stock/umbrales
 * @description HU-7 — Configuración manual de `punto_pedido`/`stock_seguridad`
 * de una combinación VarianteSKU/Depósito existente. Expone vía REST la misma
 * lógica de servicio ya usada por el Server Action equivalente
 * (`app/(dashboard)/inventario/depositos/actions.ts`) — no reimplementa nada,
 * delega directo en `actualizarUmbrales()` de `stock.service.ts`.
 *
 * Mismo patrón que `escaner/resolver/route.ts` (el único otro Route Handler
 * real de Módulo A hoy): gateado con `withAuth` (sesión requerida), sin
 * `withPermission` granular — Módulo A todavía no tiene ningún permiso
 * "inventario:*" wireado a un Route Handler en este sprint (`prisma/seed.ts`
 * deja "inventario:operar" como placeholder sin uso real).
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-permission";
import { ActualizarUmbralesStockSchema } from "@/lib/schemas/inventario.schema";
import { actualizarUmbrales } from "@/lib/services/inventario/stock.service";
import { ServiceError } from "@/lib/errors/service-error";

export const PATCH = withAuth(async (req: NextRequest, session) => {
  const body = await req.json().catch(() => null);
  const parsed = ActualizarUmbralesStockSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Datos inválidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const actualizado = await actualizarUmbrales(parsed.data, session.userId);

    return NextResponse.json(
      {
        data: {
          stock_deposito_id: actualizado.id,
          variante_sku_id: actualizado.variante_sku_id,
          deposito_id: actualizado.deposito_id,
          punto_pedido: actualizado.punto_pedido,
          stock_seguridad: actualizado.stock_seguridad,
        },
        error: null,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === "STOCK_DEPOSITO_NO_ENCONTRADO" ? 404 : 400;
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status },
      );
    }

    console.error("[PATCH /api/inventario/stock/umbrales] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
