/**
 * @module route — GET /api/ecommerce/auditoria/pagos/[id]/facturacion
 * @description HU-E6 (spec_modulo_E.md §2.6, R3) — lectura del dato de
 * facturación cifrado de una transacción, reservada EXCLUSIVAMENTE al Auditor
 * (`auditoria:leer_forense`). Wrapper fino: `withPermission` + validación del
 * `[id]` + service. El Administrador E-commerce nunca accede al campo cifrado,
 * ni con acceso aprobado: el wrapper lo corta con `403 FORBIDDEN`.
 *
 * Cada lectura emite `ecommerce:acceso_dato_cifrado_auditado` exactamente una
 * vez (en el service). El valor descifrado se devuelve en `data` y NUNCA se
 * loguea.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 TRANSACCION_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { TransaccionPagoLogIdSchema } from "@/lib/schemas/ecommerce.schema";
import {
  obtenerFacturacionPago,
  PERMISO_AUDITORIA_LEER_FORENSE,
} from "@/lib/services/ecommerce/auditoria-pagos.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  FORBIDDEN: 403,
  TRANSACCION_NO_ENCONTRADA: 404,
};

export const GET = withPermission(
  PERMISO_AUDITORIA_LEER_FORENSE,
  async (_req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = TransaccionPagoLogIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    try {
      const data = await obtenerFacturacionPago(parsedId.data, session);
      return NextResponse.json({ data, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error(
        "[GET /api/ecommerce/auditoria/pagos/[id]/facturacion] Error inesperado:",
        err,
      );
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
