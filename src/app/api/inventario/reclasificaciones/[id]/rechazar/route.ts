/**
 * @module route — PATCH /api/inventario/reclasificaciones/[id]/rechazar
 * @description HU-A9 (spec_modulo_A.md §3.8) — Rechazo de una
 * `ReclasificacionSolicitud` en `PENDIENTE_APROBACION` por un Administrador,
 * con `rechazada_motivo` obligatorio. Sin movimiento ni impacto de stock;
 * emite `stock:reclasificacion_solicitud_rechazada` post-COMMIT.
 *
 * Gateado con `withPermission("inventario:reclasificar_aprobar")` — permiso
 * exclusivo de ADMINISTRADOR (matriz RBAC del Alcance).
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR /
 * SOLICITUD_RECHAZADA_MOTIVO_REQUERIDO · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 SOLICITUD_NO_ENCONTRADA · 422 SOLICITUD_NO_PENDIENTE ·
 * 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  RechazarSolicitudSchema,
  SolicitudReclasificacionIdSchema,
} from "@/lib/schemas/inventario.schema";
import { rechazarSolicitud } from "@/lib/services/inventario/reclasificacion.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withPermission(
  "inventario:reclasificar_aprobar",
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = SolicitudReclasificacionIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const parsed = RechazarSolicitudSchema.safeParse(await req.json().catch(() => null));
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
      const resultado = await rechazarSolicitud(
        parsedId.data,
        session.userId,
        parsed.data.rechazada_motivo,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (error) {
      if (error instanceof ServiceError) {
        let status = 422;
        switch (error.code) {
          case "SOLICITUD_NO_ENCONTRADA":
            status = 404;
            break;
          case "SOLICITUD_RECHAZADA_MOTIVO_REQUERIDO":
            status = 400;
            break;
          default:
            status = 422;
        }
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status },
        );
      }
      console.error("[PATCH /api/inventario/reclasificaciones/[id]/rechazar] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);