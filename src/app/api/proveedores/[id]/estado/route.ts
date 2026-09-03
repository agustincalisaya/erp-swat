/**
 * @module route — PATCH /api/proveedores/[id]/estado
 * @description HU-H1 §2.2 — Homologar / suspender un proveedor (transición
 * manual de estado). Wrapper fino (spec §1): resuelve sesión, valida el id y
 * el body con Zod, verifica el permiso granular `proveedores:homologar`
 * (Supervisor de Compras directo — spec §2.2), delega en
 * `cambiarEstadoProveedor()` y mapea el resultado/excepción.
 *
 * Se usa `withAuth` + `usuarioTienePermiso` (mismo patrón que
 * `PATCH /api/ordenes-compra/[id]/estado` de H3): el chequeo de permiso vive
 * adentro del handler.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PROVEEDOR_NO_ENCONTRADO ·
 * 422 TRANSICION_INVALIDA · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth, usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  CambiarEstadoProveedorSchema,
  ProveedorIdSchema,
} from "@/lib/schemas/proveedores.schema";
import {
  cambiarEstadoProveedor,
  PERMISO_HOMOLOGAR,
} from "@/lib/services/proveedores/proveedor.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PROVEEDOR_NO_ENCONTRADO: 404,
  TRANSICION_INVALIDA: 422,
};

export const PATCH = withAuth(async (req: NextRequest, session, rawContext) => {
  const { id } = await (rawContext as Context).params;
  const parsedId = ProveedorIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsedId.error.issues[0]?.message ?? "ID inválido",
        },
      },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = CambiarEstadoProveedorSchema.safeParse(body);
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

  if (!(await usuarioTienePermiso(session.userId, PERMISO_HOMOLOGAR))) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: `No tenés el permiso "${PERMISO_HOMOLOGAR}" requerido para homologar o suspender un proveedor`,
        },
      },
      { status: 403 },
    );
  }

  try {
    const resultado = await cambiarEstadoProveedor(
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
    console.error("[PATCH /api/proveedores/[id]/estado] Error inesperado:", err);
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});