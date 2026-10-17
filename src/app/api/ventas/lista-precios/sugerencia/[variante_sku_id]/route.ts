/**
 * @module route — GET /api/ventas/lista-precios/sugerencia/[variante_sku_id]
 * @description HU-B9 §2.9 — Sugerencia de precio por SKU (costo de reposición
 * × (1 + margen configurable)). Wrapper fino: sesión + permiso
 * `ventas:gestionar_lista_precios`, valida el path param, delega en
 * `obtenerSugerenciaPrecio()`.
 *
 * Shape (PROPUESTA aprobada, Punto abierto 7): `{ variante_sku_id,
 * costo_reposicion_referencia, margen, precio_sugerido }`; sin costo de
 * reposición → 200 con ambos en `null`.
 *
 * Respuestas: 200 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 CONFIGURACION_NO_ENCONTRADA · 500 CONFIGURACION_INVALIDA / INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { VarianteSkuIdSchema } from "@/lib/schemas/ventas.schema";
import {
  obtenerSugerenciaPrecio,
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
} from "@/lib/services/ventas/lista-precio-venta.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ variante_sku_id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  VARIANTE_NO_ENCONTRADA: 422,
  CONFIGURACION_NO_ENCONTRADA: 404,
  CONFIGURACION_INVALIDA: 500,
  DUPLICADO_LISTA_PRECIO_ITEM: 500,
};

export const GET = withPermission(
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
  async (_req: NextRequest, _session, rawContext) => {
    const { variante_sku_id } = await (rawContext as Context).params;
    const parsedId = VarianteSkuIdSchema.safeParse(variante_sku_id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    try {
      const resultado = await obtenerSugerenciaPrecio(parsedId.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[GET /api/ventas/lista-precios/sugerencia/[variante_sku_id]] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
