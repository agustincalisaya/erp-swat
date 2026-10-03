/**
 * @module route — POST /api/ventas/lista-precios/versiones
 * @description HU-B9 §2.9 — Publicación de una versión de la Lista de Precios
 * de Venta. Wrapper fino (spec §1): sesión + permiso
 * `ventas:gestionar_lista_precios`, valida el body con Zod, delega en
 * `publicarVersionListaPrecioVenta()` y mapea resultado/excepción.
 *
 * `error.details.variante_sku_id` se propaga en el 422 de bajo costo
 * (PROPUESTA aprobada, precedente `ARTICULO_NO_DISPONIBLE` de spec E §2.1).
 *
 * Respuestas: 201 · 400 VALIDATION_ERROR / ITEM_DUPLICADO_EN_VERSION ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 409 LISTA_PRECIO_VENTA_NO_CONFIGURADA ·
 * 422 MOTIVO_BAJO_COSTO_REQUERIDO / VARIANTE_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearVersionListaPrecioVentaSchema } from "@/lib/schemas/ventas.schema";
import {
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
  publicarVersionListaPrecioVenta,
} from "@/lib/services/ventas/lista-precio-venta.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  ITEM_DUPLICADO_EN_VERSION: 400,
  LISTA_PRECIO_VENTA_NO_CONFIGURADA: 409,
  MOTIVO_BAJO_COSTO_REQUERIDO: 422,
  VARIANTE_NO_ENCONTRADA: 422,
  DUPLICADO_LISTA_PRECIO_ITEM: 500,
};

export const POST = withPermission(
  PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = CrearVersionListaPrecioVentaSchema.safeParse(body);
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
      const resultado = await publicarVersionListaPrecioVenta(parsed.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          {
            data: null,
            error: {
              code: err.code,
              message: err.message,
              ...(err.details !== undefined ? { details: err.details } : {}),
            },
          },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/ventas/lista-precios/versiones] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
