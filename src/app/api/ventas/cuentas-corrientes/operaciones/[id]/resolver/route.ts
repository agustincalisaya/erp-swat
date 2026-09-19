/**
 * @module route — PATCH /api/ventas/cuentas-corrientes/operaciones/[id]/resolver
 * @description HU-B5 §2.3 — Aprobación/rechazo de una operación de cuenta
 * corriente RETENIDA por exceso de límite de crédito. Wrapper fino (spec §1):
 * sesión + permiso EXCLUSIVO `ventas:autorizar_excepcion_credito` (Supervisor
 * de Ventas; el Cajero no llega a este endpoint), valida path param + body,
 * delega en `resolverExcepcionCredito()` con el usuario de la sesión como
 * autorizante. Sin lógica de negocio acá.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 404 OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA · 409 TRANSICION_INVALIDA ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  OperacionCuentaCorrienteIdSchema,
  ResolverExcepcionCreditoSchema,
} from "@/lib/schemas/ventas.schema";
import {
  PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO,
  resolverExcepcionCredito,
} from "@/lib/services/ventas/cuenta-corriente.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  OPERACION_CUENTA_CORRIENTE_NO_ENCONTRADA: 404,
  TRANSICION_INVALIDA: 409,
};

export const PATCH = withPermission(
  PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = OperacionCuentaCorrienteIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = ResolverExcepcionCreditoSchema.safeParse(body);
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
      const resultado = await resolverExcepcionCredito(parsedId.data, parsed.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/ventas/cuentas-corrientes/operaciones/[id]/resolver] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
