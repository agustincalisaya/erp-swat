/**
 * @module route — GET /api/ecommerce/preparacion
 * @description HU-E12 T08 — Cola de preparación Pick&Pack.
 *
 * Capa HTTP fina: autenticación, RBAC, validación Zod y delegación al service.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ColaPreparacionQuerySchema } from "@/lib/schemas/pick-pack.schema";
import { listarColaPreparacion } from "@/lib/services/ecommerce/pick-pack.service";

export const GET = withPermission(
  "ecommerce:leer_cola_preparacion",
  async (req: NextRequest) => {
    const rawQuery = Object.fromEntries(req.nextUrl.searchParams);
    const parsed = ColaPreparacionQuerySchema.safeParse(rawQuery);

    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Query inválida",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    try {
      return NextResponse.json({ data: await listarColaPreparacion(parsed.data), error: null });
    } catch (error) {
      console.error("[GET /api/ecommerce/preparacion]", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
        { status: 500 },
      );
    }
  },
);
