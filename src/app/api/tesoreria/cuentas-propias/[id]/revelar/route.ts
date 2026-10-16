/**
 * @module route — POST /api/tesoreria/cuentas-propias/[id]/revelar
 * @description HU-G5 §9.7 (G5-3) — revelado EXPLÍCITO del CBU/alias en claro de
 * una cuenta propia activa. Wrapper fino: sesión + permiso
 * `tesoreria:ver_datos_bancarios` (independiente del de lectura enmascarada) vía
 * HOF, delegación en `revelarDatosBancarios()`. El servicio vuelve a verificar
 * el permiso y audita la lectura (`tesoreria:datos_bancarios_consultados`).
 *
 * La respuesta lleva `Cache-Control: no-store` para que el dato sensible nunca
 * quede en cachés intermedias.
 *
 * Respuestas: 200 OK (no-store) · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 CUENTA_PROPRIA_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CuentaPropiaIdSchema } from "@/lib/schemas/cuenta-propia.schema";
import {
  PERMISO_VER_DATOS_BANCARIOS,
  revelarDatosBancarios,
} from "@/lib/services/tesoreria/cuenta-propia.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CUENTA_PROPRIA_NO_ENCONTRADA: 404,
  FORBIDDEN: 403,
};

export const POST = withPermission(
  PERMISO_VER_DATOS_BANCARIOS,
  async (_req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = CuentaPropiaIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        {
          data: null,
          error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message },
        },
        { status: 400 },
      );
    }

    try {
      const revelado = await revelarDatosBancarios(parsedId.data, session.userId);
      return NextResponse.json(
        { data: revelado, error: null },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/tesoreria/cuentas-propias/[id]/revelar] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
