/**
 * @module route — PATCH /api/tesoreria/cuentas-propias/[id]
 * @description HU-G5 §9.7 (G5-1/G5-3) — edición parcial de una cuenta propia.
 * Wrapper fino: sesión + permiso `tesoreria:gestionar_cuentas_bancarias` vía HOF,
 * validación del `id` de path y del body con Zod, delegación en
 * `editarCuentaPropia()`. Los campos sensibles (CBU/alias) se re-cifran por
 * campo en el servicio; el valor en claro nunca se loguea ni se responde.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 CUENTA_PROPRIA_NO_ENCONTRADA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  CuentaPropiaIdSchema,
  EditarCuentaPropiaSchema,
} from "@/lib/schemas/cuenta-propia.schema";
import {
  editarCuentaPropia,
  PERMISO_GESTIONAR_CUENTAS_BANCARIAS,
} from "@/lib/services/tesoreria/cuenta-propia.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CUENTA_PROPRIA_NO_ENCONTRADA: 404,
};

export const PATCH = withPermission(
  PERMISO_GESTIONAR_CUENTAS_BANCARIAS,
  async (req: NextRequest, session, rawContext) => {
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

    const body = await req.json().catch(() => null);
    const parsed = EditarCuentaPropiaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Datos inválidos",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    try {
      const editada = await editarCuentaPropia(parsedId.data, parsed.data, session.userId);
      return NextResponse.json({ data: editada, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/tesoreria/cuentas-propias/[id]] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
