/**
 * @module route — PATCH /api/ventas/presupuestos/[id]/aceptar
 * @description HU-B3 §2.3 — Conversión de un Presupuesto `EMITIDO` en un
 * `PedidoVenta` `RESERVADO` (spec §3.1), reutilizando la Reserva ya
 * congelada sin volver a tocar stock. Wrapper fino (spec §1): resuelve
 * sesión + permiso granular `ventas:emitir_cotizacion` (mismo permiso que el
 * alta, spec §2.3), valida el `id` del path con Zod, delega en
 * `aceptarPresupuesto()` y mapea el resultado/excepción. NINGUNA regla de
 * negocio vive acá.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PRESUPUESTO_NO_ENCONTRADO · 409 PRESUPUESTO_VENCIDO /
 * TRANSICION_INVALIDA / PRESUPUESTO_YA_CONVERTIDO · 500 RESERVA_FALTANTE /
 * INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { PresupuestoIdSchema } from "@/lib/schemas/ventas.schema";
import {
  aceptarPresupuesto,
  PERMISO_VENTAS_EMITIR_COTIZACION,
} from "@/lib/services/ventas/presupuesto.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PRESUPUESTO_NO_ENCONTRADO: 404,
  PRESUPUESTO_VENCIDO: 409,
  TRANSICION_INVALIDA: 409,
  PRESUPUESTO_YA_CONVERTIDO: 409,
  RESERVA_FALTANTE: 500,
};

export const PATCH = withPermission(
  PERMISO_VENTAS_EMITIR_COTIZACION,
  async (_req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = PresupuestoIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    try {
      const resultado = await aceptarPresupuesto(parsedId.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/ventas/presupuestos/[id]/aceptar] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
