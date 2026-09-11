/**
 * @module route — PATCH /api/ordenes-compra/[id]/estado
 * @description HU-H3 §2.5 — Transición de estado de una Orden de Compra
 * (`ENVIAR` / `CONFIRMAR` / `CERRAR` / `CANCELAR`). Wrapper fino (spec §1):
 * resuelve sesión, valida el body con Zod, verifica el permiso GRANULAR que
 * corresponde a la acción pedida (`ordenes_compra:enviar` /
 * `:confirmar` / `:cerrar` / `:cancelar` — no un único permiso de
 * "administrar"), delega en `cambiarEstadoOrdenCompra()` y mapea el
 * resultado/excepción. NINGUNA regla de negocio vive acá.
 *
 * El permiso se verifica DESPUÉS de parsear el body porque depende de la
 * `accion`; por eso este handler usa `withAuth` y hace el chequeo granular
 * adentro, en vez de `withPermission(<código fijo>)`.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 ORDEN_NO_ENCONTRADA · 409 TRANSICION_INVALIDA ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth, usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  CambiarEstadoOrdenCompraSchema,
  OrdenCompraIdSchema,
} from "@/lib/schemas/ordenes-compra.schema";
import {
  cambiarEstadoOrdenCompra,
  PERMISO_POR_ACCION_ORDEN_COMPRA,
} from "@/lib/services/proveedores/orden-compra.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  ORDEN_NO_ENCONTRADA: 404,
  TRANSICION_INVALIDA: 409,
  ORDEN_ITEMS_BLOQUEADOS: 409,
};

export const PATCH = withAuth(async (req: NextRequest, session, rawContext) => {
  const { id } = await (rawContext as Context).params;
  const parsedId = OrdenCompraIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = CambiarEstadoOrdenCompraSchema.safeParse(body);
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

  const permiso = PERMISO_POR_ACCION_ORDEN_COMPRA[parsed.data.accion];
  if (!(await usuarioTienePermiso(session.userId, permiso))) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: `No tenés el permiso "${permiso}" requerido para ${parsed.data.accion} una orden de compra`,
        },
      },
      { status: 403 },
    );
  }

  try {
    const resultado = await cambiarEstadoOrdenCompra(
      parsedId.data,
      parsed.data,
      session.userId,
    );
    return NextResponse.json({ data: resultado, error: null }, { status: 200 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { data: null, error: { code: err.code, message: err.message } },
        { status: STATUS_POR_CODIGO[err.code] ?? 400 },
      );
    }
    console.error("[PATCH /api/ordenes-compra/[id]/estado] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
