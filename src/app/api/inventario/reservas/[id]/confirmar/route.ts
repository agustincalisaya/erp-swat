/**
 * @module route — PATCH /api/inventario/reservas/[id]/confirmar
 * @description HU-A10 (spec_modulo_A.md §2.9) — Liberación de una Reserva por
 * venta confirmada (RESERVADO → VENDIDO). NO reincrementa stock. Invocado
 * internamente por Módulo B/E cuando la venta que originó la reserva se
 * confirma.
 *
 * Toda la lógica transaccional vive en `reserva.service.ts`.
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 RESERVA_NO_ENCONTRADA ·
 * 409 RESERVA_INACTIVA / RESERVA_NO_ACTIVA · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ConfirmarReservaSchema, ReservaIdSchema } from "@/lib/schemas/inventario.schema";
import { confirmarReservaPorVenta } from "@/lib/services/inventario/reserva.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withPermission(
  "inventario:confirmar_reserva",
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = ReservaIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const parsed = ConfirmarReservaSchema.safeParse(await req.json().catch(() => null));
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
      return NextResponse.json({
        data: await confirmarReservaPorVenta(parsedId.data, parsed.data.venta_id, session.userId),
        error: null,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        const status = ["RESERVA_INACTIVA", "RESERVA_NO_ACTIVA"].includes(error.code) ? 409 : 404;
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status },
        );
      }
      console.error("[confirmar reserva]", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
        { status: 500 },
      );
    }
  },
);
