/**
 * @module route — PATCH /api/ecommerce/preparacion/[pedidoVentaId]/prioridad
 * @description HU-E12 T08 — Cambiar/resetear prioridad de un pedido.
 *
 * Capa HTTP fina: autenticación, RBAC, validación Zod y delegación al service.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 PEDIDO_NO_OPERABLE ·
 * 409 ESTADO_INVALIDO / PEDIDO_TOMADO_NO_PRIORIZABLE · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { PedidoPickPackIdSchema, PriorizarPedidoSchema } from "@/lib/schemas/pick-pack.schema";
import { actualizarPrioridad } from "@/lib/services/ecommerce/pick-pack.service";
import { ServiceError } from "@/lib/errors/service-error";
import { mapearErrorPickPack } from "../error-mapper";

type Context = { params: Promise<{ pedidoVentaId: string }> };

export const PATCH = withPermission(
  "ecommerce:priorizar_cola",
  async (req: NextRequest, session, rawContext) => {
    const { pedidoVentaId } = await (rawContext as Context).params;

    const parsedId = PedidoPickPackIdSchema.safeParse(pedidoVentaId);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const parsed = PriorizarPedidoSchema.safeParse(await req.json().catch(() => null));
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
      const data = await actualizarPrioridad(
        parsedId.data,
        session.userId,
        parsed.data.prioridad_manual,
      );
      return NextResponse.json({ data, error: null });
    } catch (error) {
      if (error instanceof ServiceError) {
        if (error.code === "PEDIDO_TOMADO_NO_PRIORIZABLE") {
          return NextResponse.json(
            { data: null, error: { code: error.code, message: error.message } },
            { status: 409 },
          );
        }
        return mapearErrorPickPack(error);
      }
      console.error("[PATCH /api/ecommerce/preparacion/[id]/prioridad]", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
        { status: 500 },
      );
    }
  },
);
