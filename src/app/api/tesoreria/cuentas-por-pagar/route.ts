/**
 * @module route — GET /api/tesoreria/cuentas-por-pagar
 * @description HU-G8 §2.5 — Listado paginado de Cuentas por Pagar. Wrapper
 * fino (spec §1): resuelve sesión + permiso `cuentas_por_pagar:leer` vía HOF
 * (el acceso está totalmente determinado por el permiso), valida los filtros
 * de la URL con Zod y delega en `listarCuentasPorPagar()`. NINGUNA regla de
 * negocio vive acá — el `select` whitelist del proveedor y el mapeo de
 * `monto` a `string` viven en el servicio.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { FiltrosListadoCuentasPorPagarSchema } from "@/lib/schemas/cuentas-por-pagar.schema";
import {
  listarCuentasPorPagar,
  PERMISO_LEER_CUENTAS_POR_PAGAR,
} from "@/lib/services/tesoreria/cuenta-por-pagar.service";
import { ServiceError } from "@/lib/errors/service-error";

export const GET = withPermission(
  PERMISO_LEER_CUENTAS_POR_PAGAR,
  async (req: NextRequest) => {
    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = FiltrosListadoCuentasPorPagarSchema.safeParse(queryParams);

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
      const resultado = await listarCuentasPorPagar(parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: 400 },
        );
      }
      console.error("[GET /api/tesoreria/cuentas-por-pagar] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
