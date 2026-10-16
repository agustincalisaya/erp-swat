/**
 * @module route — POST /api/tesoreria/cuentas-propias/[id]/baja
 * @description HU-G5 §9.7 (G5-1) — baja LÓGICA de una cuenta propia.
 * Wrapper fino: sesión + permiso `tesoreria:gestionar_cuentas_bancarias` vía HOF,
 * validación del `id` y del motivo con Zod (obligatorio), delegación en
 * `darDeBajaCuentaPropia()`. NUNCA hay borrado físico (RULES.md Regla 1): el
 * servicio setea `is_active=false` + la tripleta `deleted_*`.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR / motivo inválido ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 CUENTA_PROPRIA_NO_ENCONTRADA ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  CuentaPropiaIdSchema,
  DarDeBajaCuentaPropiaSchema,
} from "@/lib/schemas/cuenta-propia.schema";
import {
  darDeBajaCuentaPropia,
  PERMISO_GESTIONAR_CUENTAS_BANCARIAS,
} from "@/lib/services/tesoreria/cuenta-propia.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CUENTA_PROPRIA_NO_ENCONTRADA: 404,
};

export const POST = withPermission(
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
    const parsed = DarDeBajaCuentaPropiaSchema.safeParse(body);
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
      const dada = await darDeBajaCuentaPropia(parsedId.data, parsed.data, session.userId);
      return NextResponse.json({ data: dada, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[POST /api/tesoreria/cuentas-propias/[id]/baja] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
