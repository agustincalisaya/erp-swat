/**
 * @module route — POST /api/proveedores/[id]/lista-precios
 * @description HU-H2 (Módulo H) — Publicación de una nueva versión de lista
 * de precios de proveedor (`docs/tasks/sdd/HU-H2/spec.md`, "Endpoint de
 * publicación"). Wrapper fino (mismo patrón que
 * `POST /api/ordenes-compra/route.ts`): resuelve sesión + permiso granular
 * `proveedores:publicar_lista`, valida el path param `id` y el body con Zod,
 * delega en `publicarNuevaVersionListaPrecio()` y mapea el
 * resultado/excepción al shape `{ data, error }`. NINGUNA regla de negocio
 * vive acá.
 *
 * Respuestas: 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PROVEEDOR_INEXISTENTE · 422 PROVEEDOR_NO_HOMOLOGADO /
 * VARIANTE_SKU_INEXISTENTE / FECHA_DUPLICADA / ITEMS_DUPLICADOS ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  esErrorItemsDuplicados,
  PublicarListaPreciosSchema,
} from "@/lib/schemas/lista-precios.schema";
import { ProveedorIdSchema } from "@/lib/schemas/proveedores.schema";
import {
  publicarNuevaVersionListaPrecio,
  PERMISO_PUBLICAR_LISTA_PRECIO,
} from "@/lib/services/proveedores/lista-precios.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PROVEEDOR_INEXISTENTE: 404,
  PROVEEDOR_NO_HOMOLOGADO: 422,
  VARIANTE_SKU_INEXISTENTE: 422,
  FECHA_DUPLICADA: 422,
  ITEMS_DUPLICADOS: 422,
};

export const POST = withPermission(
  PERMISO_PUBLICAR_LISTA_PRECIO,
  async (req: NextRequest, session, context) => {
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
    const parsed = PublicarListaPreciosSchema.safeParse(body);
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
      const resultado = await publicarNuevaVersionListaPrecio(
        parsedId.data,
        parsed.data.fecha_inicio_vigencia,
        parsed.data.items,
        session.userId,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/proveedores/[id]/lista-precios] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
