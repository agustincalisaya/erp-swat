/**
 * @module route — POST /api/ordenes-compra
 * @description HU-H3 §2.4 — Emisión de una Orden de Compra en estado
 * `BORRADOR`. Wrapper fino (spec §1): resuelve sesión + permiso granular
 * `ordenes_compra:crear`, valida el body con Zod, delega en
 * `crearOrdenCompra()` y mapea el resultado/excepción al shape
 * `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * Respuestas: 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PROVEEDOR_NO_ENCONTRADO · 422 PROVEEDOR_NO_HOMOLOGADO /
 * PROVEEDOR_SIN_LISTA_VIGENTE / SKU_INVALIDO / SKU_SIN_PRECIO_VIGENTE /
 * ITEMS_DUPLICADOS · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearOrdenCompraSchema } from "@/lib/schemas/ordenes-compra.schema";
import {
  crearOrdenCompra,
  PERMISO_CREAR_ORDEN_COMPRA,
} from "@/lib/services/proveedores/orden-compra.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  PROVEEDOR_NO_ENCONTRADO: 404,
  PROVEEDOR_NO_HOMOLOGADO: 422,
  PROVEEDOR_SIN_LISTA_VIGENTE: 422,
  SKU_INVALIDO: 422,
  SKU_SIN_PRECIO_VIGENTE: 422,
  ITEMS_DUPLICADOS: 422,
};

export const POST = withPermission(
  PERMISO_CREAR_ORDEN_COMPRA,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = CrearOrdenCompraSchema.safeParse(body);
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
      const resultado = await crearOrdenCompra(parsed.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/ordenes-compra] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
