/**
 * @module route — GET /api/tesoreria/ingresos-web
 * @description HU-G11 §2.6 — Listado paginado de ingresos de Tesorería por
 * cobros web. Wrapper fino (spec §1): resuelve sesión + permiso
 * `tesoreria:leer_ingresos_web` vía HOF, valida los filtros de la URL con Zod
 * y delega en `listarIngresosWeb()`. NINGUNA regla de negocio vive acá.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { FiltrosIngresosWebSchema } from "@/lib/schemas/ingresos-web.schema";
import {
  listarIngresosWeb,
  PERMISO_LEER_INGRESOS_WEB,
} from "@/lib/services/tesoreria/ingreso-tesoreria.service";
import { ServiceError } from "@/lib/errors/service-error";

export const GET = withPermission(
  PERMISO_LEER_INGRESOS_WEB,
  async (req: NextRequest) => {
    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = FiltrosIngresosWebSchema.safeParse(queryParams);

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
      const resultado = await listarIngresosWeb(parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[GET /api/tesoreria/ingresos-web] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
