/**
 * @module route — GET /api/tesoreria/comprobantes
 * @description HU-G3 §9.5 — Listado paginado del repositorio de comprobantes
 * fiscales (mostrador y web). Wrapper fino, mismo patrón que
 * `/api/tesoreria/ingresos-web`: sesión + permiso `tesoreria:leer_comprobantes`
 * vía HOF, filtros de la URL con Zod y delegación en `listarComprobantes()`.
 * Solo GET: el repositorio no edita ni da de baja comprobantes (G3-5).
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR / FILTRO_INVALIDO ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { FiltrosComprobantesSchema } from "@/lib/schemas/comprobantes-repositorio.schema";
import {
  listarComprobantes,
  PERMISO_LEER_COMPROBANTES,
} from "@/lib/services/tesoreria/comprobantes-repositorio.service";
import { ServiceError } from "@/lib/errors/service-error";

export const GET = withPermission(
  PERMISO_LEER_COMPROBANTES,
  async (req: NextRequest) => {
    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = FiltrosComprobantesSchema.safeParse(queryParams);

    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Los filtros enviados no son válidos",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await listarComprobantes(parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[GET /api/tesoreria/comprobantes] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
