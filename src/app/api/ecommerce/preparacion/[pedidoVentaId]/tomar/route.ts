/**
 * @module route — POST /api/ecommerce/preparacion/[pedidoVentaId]/tomar
 * @description HU-E12 T08 — Tomar un pedido para preparación.
 *
 * Capa HTTP fina: autenticación, RBAC, validación Zod y delegación al service.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 PEDIDO_NO_OPERABLE ·
 * 409 ESTADO_INVALIDO / PEDIDO_YA_TOMADO / CONCURRENCIA_ASIGNACION ·
 * 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { PedidoPickPackIdSchema, TomarPedidoSchema } from "@/lib/schemas/pick-pack.schema";
import { tomarPedido } from "@/lib/services/ecommerce/pick-pack.service";
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

    const parsed = TomarPedidoSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Body inválido",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    try {
      const data = await tomarPedido(parsedId.data, session.userId);
      return NextResponse.json({ data, error: null });
    } catch (error) {
      if (error instanceof ServiceError) {
        return mapearErrorPickPack(error);
      }
      console.error("[POST /api/ecommerce/preparacion/[id]/tomar]", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
        { status: 500 },
      );
    }
  },
);
