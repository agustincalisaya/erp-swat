/**
 * @module route — POST /api/ecommerce/preparacion/[pedidoVentaId]/scan
 * @description HU-E12 T08 — Confirmar un ítem por escaneo (SKU/EAN).
 *
 * Capa HTTP fina: autenticación, RBAC, validación Zod y delegación al service.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 PEDIDO_NO_OPERABLE ·
 * 409 ESTADO_INVALIDO / PEDIDO_NO_ASIGNADO / SCAN_ID_CONFLICTO /
 *    CODIGO_NO_PERTENECE_PEDIDO / CANTIDAD_YA_COMPLETA · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ConfirmarItemPreparacionSchema, PedidoPickPackIdSchema } from "@/lib/schemas/pick-pack.schema";
import { confirmarItem } from "@/lib/services/ecommerce/pick-pack.service";
import { ServiceError } from "@/lib/errors/service-error";
import { mapearErrorPickPack } from "../error-mapper";

type Context = { params: Promise<{ pedidoVentaId: string }> };

export const POST = withPermission(
  "ecommerce:preparar_pedido",
  async (req: NextRequest, session, rawContext) => {
    const { pedidoVentaId } = await (rawContext as Context).params;

    const parsedId = PedidoPickPackIdSchema.safeParse(pedidoVentaId);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const parsed = ConfirmarItemPreparacionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Datos inválidos",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    try {
      const data = await confirmarItem(parsedId.data, session.userId, parsed.data);
      return NextResponse.json({ data, error: null });
    } catch (error) {
      if (error instanceof ServiceError) {
        return mapearErrorPickPack(error);
      }
      console.error("[POST /api/ecommerce/preparacion/[id]/scan]", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
        { status: 500 },
      );
    }
  },
);
