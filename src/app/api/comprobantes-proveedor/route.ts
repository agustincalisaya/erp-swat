/**
 * @module route — GET /api/comprobantes-proveedor
 * @description HU-H9 §2.7 (spec_modulo_H.md) — Listado global paginado de
 * Comprobantes de Proveedor. Insumo de HU-G10 (Tesorería) y del listado
 * operativo del Comprador. Wrapper fino (spec §1): resuelve sesión + permiso
 * `comprobantes_proveedor:leer`, valida los filtros de la URL con Zod y delega
 * en `listarComprobantesProveedor()`. NINGUNA regla de negocio vive acá — el
 * `select` whitelist y el mapeo de `monto_total` a `string` viven en el
 * servicio.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { usuarioTienePermiso, withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { FiltrosListadoComprobantesProveedorSchema } from "@/lib/schemas/comprobantes-proveedor.schema";
import {
  listarComprobantesProveedor,
  PERMISO_LEER,
} from "@/lib/services/proveedores/comprobante-proveedor.service";

/** Ver comprobantes anulados en el listado es privilegio de Auditoría (RULES.md Regla N.° 1). */
const PERMISO_AUDITORIA = "auditoria:leer_forense";

export const GET = withPermission(PERMISO_LEER, async (req: NextRequest, session) => {
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = FiltrosListadoComprobantesProveedorSchema.safeParse(queryParams);

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
    const incluirAnulados = await usuarioTienePermiso(session.userId, PERMISO_AUDITORIA);
    const resultado = await listarComprobantesProveedor(parsed.data, { incluirAnulados });
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: error.code, message: error.message } },
        { status: 400 },
      );
    }
    console.error("[GET /api/comprobantes-proveedor] Error inesperado:", error);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
