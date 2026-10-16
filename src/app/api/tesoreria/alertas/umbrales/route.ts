/**
 * @module route — PATCH /api/tesoreria/alertas/umbrales
 * @description HU-D6 (task_relos.md D10, D24, D25) — edición de los tres
 * umbrales del % de egresos sobre ingresos como conjunto. Wrapper fino:
 * `withPermission("configuracion:administrar")` (exclusivo Administrador; el
 * Gerente lee el panel pero no edita), valida el body con
 * `UmbralesEgresosSchema` y delega en `actualizarUmbralesEgresos()`, que vuelve
 * a validar, escribe en una transacción y audita por `configuracion:actualizada`.
 * No reevalúa alertas (D10). Es el único camino de escritura de estas claves:
 * no existe un `PATCH /api/configuracion/[clave]` genérico (diferido).
 *
 * Respuestas `{ data, error }`: 200 OK (`data.umbrales`, `data.hubo_cambio`,
 * `data.claves_cambiadas`) · 400 VALIDATION_ERROR (body no JSON o conjunto
 * inválido, con `fieldErrors`) · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 * 405 METHOD_NOT_ALLOWED (otros métodos) · 409 CONFIGURACION_NO_ENCONTRADA ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { UmbralesEgresosSchema } from "@/lib/schemas/alertas-desvio.schema";
import {
  actualizarUmbralesEgresos,
  PERMISO_ADMINISTRAR_CONFIGURACION,
} from "@/lib/services/sistema/configuracion.service";

const STATUS_POR_CODIGO: Record<string, number> = {
  UMBRALES_EGRESOS_INVALIDOS: 400,
  CONFIGURACION_NO_ENCONTRADA: 409,
};

function metodoNoPermitido() {
  return NextResponse.json(
    {
      data: null,
      error: { code: "METHOD_NOT_ALLOWED", message: "Usá PATCH para actualizar los umbrales de egresos." },
    },
    { status: 405 },
  );
}

export const GET = metodoNoPermitido;
export const POST = metodoNoPermitido;
export const PUT = metodoNoPermitido;
export const DELETE = metodoNoPermitido;

export const PATCH = withPermission(PERMISO_ADMINISTRAR_CONFIGURACION, async (req: NextRequest, session) => {
  const body: unknown = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "El cuerpo debe ser un JSON válido" } },
      { status: 400 },
    );
  }

  const parsed = UmbralesEgresosSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Umbrales inválidos",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  try {
    const resultado = await actualizarUmbralesEgresos(parsed.data, session.userId);
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError && err.code in STATUS_POR_CODIGO) {
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status: STATUS_POR_CODIGO[err.code] },
      );
    }
    const codigo = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
    console.error("[PATCH /api/tesoreria/alertas/umbrales] Error inesperado:", {
      codigo_error: typeof codigo === "string" && /^[A-Z0-9_]{2,64}$/.test(codigo) ? codigo : "ERROR_INESPERADO",
    });
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
