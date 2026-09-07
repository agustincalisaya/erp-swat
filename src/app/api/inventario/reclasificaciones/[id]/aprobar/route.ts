/**
 * @module route — PATCH /api/inventario/reclasificaciones/[id]/aprobar
 * @description HU-A9 (spec_modulo_A.md §3.8) — Aprobación de una
 * `ReclasificacionSolicitud` en `PENDIENTE_APROBACION` por un Administrador.
 * Aplica el movimiento compensatorio (`MovimientoStock` AJUSTE +
 * `estado_destino = "BAJA_MERMA"`) y emite los eventos de auditoría
 * post-COMMIT. Sin body: la solicitud se identifica por el segmento `[id]`.
 *
 * Gateado con `withPermission("inventario:reclasificar_aprobar")` — permiso
 * exclusivo de ADMINISTRADOR (matriz RBAC del Alcance).
 *
 * Respuestas `{ data, error }`: 200 OK · 400 VALIDATION_ERROR ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 SOLICITUD_NO_ENCONTRADA ·
 * 422 SOLICITUD_NO_PENDIENTE · 500 INTERNAL_ERROR.
 */
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  AprobarSolicitudSchema,
  SolicitudReclasificacionIdSchema,
} from "@/lib/schemas/inventario.schema";
import { aprobarSolicitud } from "@/lib/services/inventario/reclasificacion.service";
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

    // Body opcional y vacío por contrato: `.strict()` rechaza cualquier campo extra.
    const body = await req.json().catch(() => ({}));
    const parsed = AprobarSolicitudSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Datos inválidos",
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await aprobarSolicitud(parsedId.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (error) {
      if (error instanceof ServiceError) {
        const status = error.code === "SOLICITUD_NO_ENCONTRADA" ? 404 : 422;
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status },
        );
      }
      console.error("[PATCH /api/inventario/reclasificaciones/[id]/aprobar] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);