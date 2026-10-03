/**
 * @module route — GET /api/ventas/lista-precios/vigente?variante_sku_id=
 * @description HU-B9 §2.9 — Consulta HTTP del precio de venta vigente de un
 * SKU. Gateada por `ventas:gestionar_lista_precios` tal cual el spec (Punto
 * abierto 10, opción A): es la superficie para Postman / una futura UI del
 * Supervisor. Los consumidores internos (B1/B3/B4/E) NO pasan por acá: usan
 * `resolverPrecioVentaVigente()` directo, sin RBAC.
 *
 * Respuestas: 200 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 SKU_SIN_PRECIO_VIGENTE · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { PrecioVigenteQuerySchema } from "@/lib/schemas/ventas.schema";
import {
  consultarPrecioVentaVigente,
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
} from "@/lib/services/ventas/lista-precio-venta.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  SKU_SIN_PRECIO_VIGENTE: 404,
};

export const GET = withPermission(
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
  async (req: NextRequest) => {
    const parsed = PrecioVigenteQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Parámetros inválidos",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await consultarPrecioVentaVigente(parsed.data.variante_sku_id);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[GET /api/ventas/lista-precios/vigente] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
