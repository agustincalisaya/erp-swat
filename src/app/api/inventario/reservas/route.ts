/**
 * @module route — POST /api/inventario/reservas
 * @description HU-A10 (spec_modulo_A.md §2.9) — Congelamiento de stock vía el
 * servicio centralizado de Reserva. Backend puro, sin UI: pensado para
 * invocación interna de Módulo B (HU-B3) y Módulo E (HU-E1), que NO
 * implementan lógica de reserva propia.
 *
 * Toda la lógica transaccional vive en `reserva.service.ts` — este handler
 * solo valida (Zod), delega y mapea errores.
 *
 * Respuestas `{ data, error }`: 201 Created · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 VARIANTE_NO_ENCONTRADA /
 * DEPOSITO_NO_ENCONTRADO · 422 STOCK_INSUFICIENTE · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearReservaSchema } from "@/lib/schemas/inventario.schema";
import { crearReserva } from "@/lib/services/inventario/reserva.service";
import { ServiceError } from "@/lib/errors/service-error";

export const POST = withPermission("inventario:reservar_stock", async (req: NextRequest, session) => {
  const parsed = CrearReservaSchema.safeParse(await req.json().catch(() => null));
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
    return NextResponse.json(
      { data: await crearReserva(parsed.data, session.userId), error: null },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: error.code, message: error.message } },
        { status: error.code === "STOCK_INSUFICIENTE" ? 422 : 404 },
      );
    }
    console.error("[crear reserva]", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno" } },
      { status: 500 },
    );
  }
});
