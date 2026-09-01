/**
 * @module route — PUT /api/ordenes-compra/[id]/items
 * @description HU-H3 — CA2 (Backlog Sprint 2): edición de los ítems de una
 * Orden de Compra en estado `BORRADOR` (agregar / quitar / cambiar cantidad).
 * Semántica de reemplazo total. Wrapper fino (spec §1): resuelve sesión +
 * permiso granular `ordenes_compra:crear` (editar un BORRADOR es parte de
 * armar/solicitar la orden), valida el body con Zod, delega en
 * `editarItemsOrdenCompra()` y mapea el resultado/excepción a `{ data, error }`.
 * NINGUNA regla de negocio vive acá — el precio lo resuelve el servicio, el
 * cliente nunca lo envía.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 ORDEN_NO_ENCONTRADA · 409 ORDEN_ITEMS_BLOQUEADOS ·
 * 422 SKU_INVALIDO / SKU_SIN_PRECIO_VIGENTE / ITEMS_DUPLICADOS /
 * PROVEEDOR_NO_HOMOLOGADO / PROVEEDOR_SIN_LISTA_VIGENTE · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  EditarItemsOrdenCompraSchema,
  OrdenCompraIdSchema,
} from "@/lib/schemas/ordenes-compra.schema";
import {
  editarItemsOrdenCompra,
  PERMISO_CREAR_ORDEN_COMPRA,
} from "@/lib/services/proveedores/orden-compra.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  ORDEN_NO_ENCONTRADA: 404,
  ORDEN_ITEMS_BLOQUEADOS: 409,
  PROVEEDOR_NO_ENCONTRADO: 404,
  PROVEEDOR_NO_HOMOLOGADO: 422,
  PROVEEDOR_SIN_LISTA_VIGENTE: 422,
  SKU_INVALIDO: 422,
  SKU_SIN_PRECIO_VIGENTE: 422,
  ITEMS_DUPLICADOS: 422,
};

export const PUT = withPermission(
  PERMISO_CREAR_ORDEN_COMPRA,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = OrdenCompraIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsedId.error.issues[0]?.message ?? "ID inválido",
          },
        },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = EditarItemsOrdenCompraSchema.safeParse(body);
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
      const resultado = await editarItemsOrdenCompra(
        parsedId.data,
        parsed.data,
        session.userId,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[PUT /api/ordenes-compra/[id]/items] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
