/**
 * @module route — POST /api/proveedores/[id]/lista-precios/preview
 * @description Previsualización de la variación porcentual de una posible
 * nueva versión de lista de precios, SIN persistir nada (UI "Calcular
 * variación" del formulario de publicación). Wrapper fino, mismo patrón que
 * `POST /api/proveedores/[id]/lista-precios` hermano: resuelve sesión +
 * permiso `proveedores:publicar_lista` (mismo permiso que la publicación
 * real — quien puede previsualizar es quien puede publicar), valida el path
 * param `id` y el body con Zod, delega en
 * `previsualizarVariacionListaPrecios()` y mapea el resultado/excepción al
 * shape `{ data, error }`. NINGUNA regla de negocio vive acá — la decisión
 * de variación/umbral es EXACTAMENTE la misma que usa el POST real
 * (`calcularResultadoPreview`, sin fórmula duplicada).
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PROVEEDOR_INEXISTENTE · 422 PROVEEDOR_NO_HOMOLOGADO /
 * VARIANTE_SKU_INEXISTENTE / ITEMS_DUPLICADOS · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  esErrorItemsDuplicados,
  PreviewListaPreciosSchema,
} from "@/lib/schemas/lista-precios.schema";
import { ProveedorIdSchema } from "@/lib/schemas/proveedores.schema";
import {
  previsualizarVariacionListaPrecios,
  PERMISO_PUBLICAR_LISTA_PRECIO,
} from "@/lib/services/proveedores/lista-precios.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PROVEEDOR_INEXISTENTE: 404,
  PROVEEDOR_NO_HOMOLOGADO: 422,
  VARIANTE_SKU_INEXISTENTE: 422,
  ITEMS_DUPLICADOS: 422,
};

export const POST = withPermission(
  PERMISO_PUBLICAR_LISTA_PRECIO,
  async (req: NextRequest, _session, context) => {
    const { id } = await (context as Context).params;
    const parsedId = ProveedorIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsedId.error.issues[0]?.message ?? "ID de proveedor inválido",
          },
        },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = PreviewListaPreciosSchema.safeParse(body);
    if (!parsed.success) {
      if (esErrorItemsDuplicados(parsed.error)) {
        return NextResponse.json(
          {
            data: null,
            error: {
              code: "ITEMS_DUPLICADOS",
              message: "La lista no puede incluir la misma variante en más de un ítem",
            },
          },
          { status: STATUS_POR_CODIGO.ITEMS_DUPLICADOS },
        );
      }
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
      const resultado = await previsualizarVariacionListaPrecios(
        parsedId.data,
        parsed.data.items,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/proveedores/[id]/lista-precios/preview] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
