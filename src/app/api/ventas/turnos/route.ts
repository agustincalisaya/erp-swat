/**
 * @module route — POST /api/ventas/turnos
 * @description HU-B2 §6.1 — Apertura de un turno de caja con fondo fijo
 * inicial. Wrapper fino (spec §1): resuelve sesión + permiso granular
 * `ventas:gestionar_turno_caja`, valida el body con Zod, delega en
 * `abrirTurnoCaja()` y mapea el resultado/excepción al shape `{ data, error }`.
 * NINGUNA regla de negocio vive acá.
 *
 * Respuestas: 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 409 TURNO_YA_ABIERTO · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { AbrirTurnoCajaSchema } from "@/lib/schemas/ventas.schema";
import {
  abrirTurnoCaja,
  PERMISO_VENTAS_GESTIONAR_TURNO_CAJA,
} from "@/lib/services/ventas/turno-caja.service";
import { ServiceError } from "@/lib/errors/service-error";

const STATUS_POR_CODIGO: Record<string, number> = {
  TURNO_YA_ABIERTO: 409,
};

export const POST = withPermission(
  PERMISO_VENTAS_GESTIONAR_TURNO_CAJA,
  async (req: NextRequest, session) => {
    const body = await req.json().catch(() => null);
    const parsed = AbrirTurnoCajaSchema.safeParse(body);
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
      const resultado = await abrirTurnoCaja(session.userId, parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/ventas/turnos] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
