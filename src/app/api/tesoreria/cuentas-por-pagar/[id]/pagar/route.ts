/**
 * @module route — PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar
 * @description HU-G8 §2.4 — Marcar una Cuenta por Pagar como pagada
 * (`DEFINITIVA → PAGADA`, todo-o-nada, sin evidencia de pago ni pago
 * parcial). Wrapper fino (spec §1): resuelve sesión, valida el `id` de path y
 * el body con Zod, verifica el permiso GRANULAR `cuentas_por_pagar:pagar`
 * inline (patrón de `src/app/api/ordenes-compra/[id]/estado/route.ts`, porque
 * el permiso es específico de la ruta), delega en
 * `marcarCuentaPorPagarPagada()` y mapea el resultado/excepción. NINGUNA
 * regla de negocio vive acá.
 *
 * Orden de validación (spec §2.4): (1) `id` de path → (2) body → (3) permiso.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 CUENTA_POR_PAGAR_NO_ENCONTRADA ·
 * 409 TRANSICION_INVALIDA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth, usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  CuentaPorPagarIdSchema,
  MarcarPagadaSchema,
} from "@/lib/schemas/cuentas-por-pagar.schema";
import {
  marcarCuentaPorPagarPagada,
  PERMISO_PAGAR_CUENTA_POR_PAGAR,
} from "@/lib/services/tesoreria/cuenta-por-pagar.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CUENTA_POR_PAGAR_NO_ENCONTRADA: 404,
  TRANSICION_INVALIDA: 409,
};

export const PATCH = withAuth(async (req: NextRequest, session, rawContext) => {
  const { id } = await (rawContext as Context).params;
  const parsedId = CuentaPorPagarIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = MarcarPagadaSchema.safeParse(body ?? {});
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

  if (!(await usuarioTienePermiso(session.userId, PERMISO_PAGAR_CUENTA_POR_PAGAR))) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: `No tenés el permiso "${PERMISO_PAGAR_CUENTA_POR_PAGAR}" requerido para pagar una cuenta por pagar`,
        },
      },
      { status: 403 },
    );
  }

  try {
    const resultado = await marcarCuentaPorPagarPagada(
      parsedId.data,
      parsed.data,
      session.userId,
    );
    return NextResponse.json(
      {
        data: {
          cuenta_por_pagar_id: resultado.cuenta_por_pagar_id,
          estado_anterior: resultado.estado_anterior,
          estado_nuevo: resultado.estado_nuevo,
          fecha_pago: resultado.fecha_pago,
        },
        error: null,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status: STATUS_POR_CODIGO[err.code] ?? 400 },
      );
    }
    console.error(
      "[PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar] Error inesperado:",
      err,
    );
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
