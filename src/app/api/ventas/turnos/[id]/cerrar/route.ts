/**
 * @module route — PATCH /api/ventas/turnos/[id]/cerrar
 * @description HU-B2 §6.2 — Cierre de un turno de caja con arqueo ciego. El
 * Cajero ya envía su `conteo_fisico_declarado` en el body; `saldo_esperado`/
 * `diferencia` se calculan server-side en esta misma invocación, nunca antes
 * (garantía de backend del arqueo ciego). Wrapper fino (spec §1): resuelve
 * sesión + permiso granular `ventas:gestionar_turno_caja` (mismo permiso que
 * la apertura), valida el `id` del path y el body con Zod, delega en
 * `cerrarTurnoCaja()` y mapea el resultado/excepción. NINGUNA regla de
 * negocio vive acá.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN / SIN_PERMISO_CIERRE · 404 TURNO_NO_ENCONTRADO ·
 * 409 TURNO_YA_CERRADO · 422 JUSTIFICACION_REQUERIDA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CerrarTurnoCajaSchema, TurnoCajaIdSchema } from "@/lib/schemas/ventas.schema";
import {
  cerrarTurnoCaja,
  PERMISO_VENTAS_GESTIONAR_TURNO_CAJA,
} from "@/lib/services/ventas/turno-caja.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  TURNO_NO_ENCONTRADO: 404,
  TURNO_YA_CERRADO: 409,
  SIN_PERMISO_CIERRE: 403,
  JUSTIFICACION_REQUERIDA: 422,
};

export const PATCH = withPermission(
  PERMISO_VENTAS_GESTIONAR_TURNO_CAJA,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = TurnoCajaIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsedBody = CerrarTurnoCajaSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsedBody.error.issues[0]?.message ?? "Datos inválidos",
            fieldErrors: parsedBody.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await cerrarTurnoCaja(parsedId.data, session.userId, parsedBody.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/ventas/turnos/[id]/cerrar] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
