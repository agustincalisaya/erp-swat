/**
 * @module route — PATCH /api/proveedores/[id]
 * @description HU-H1 — Edición parcial del legajo comercial de un proveedor.
 * Wrapper fino (spec §1): resuelve sesión + permiso granular
 * `proveedores:editar`, valida el id y el body con Zod, delega en
 * `editarProveedor()` y mapea el resultado/excepción.
 *
 * `cuit`/`estado` NO son editables: el schema los rechaza vía `superRefine`
 * y este wrapper distingue ese caso para responder `422 CAMPOS_NO_EDITABLES`
 * (decisión D7) en vez de un `400 VALIDATION_ERROR` genérico. `datos_bancarios`
 * es un reemplazo re-cifrado server-side — nunca llega un CBU descifrado a
 * este handler ni se devuelve en la respuesta.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PROVEEDOR_NO_ENCONTRADO · 422 CAMPOS_NO_EDITABLES ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  EditarProveedorSchema,
  esErrorCamposNoEditables,
  ProveedorIdSchema,
} from "@/lib/schemas/proveedores.schema";
import {
  editarProveedor,
  PERMISO_EDITAR,
} from "@/lib/services/proveedores/proveedor.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PROVEEDOR_NO_ENCONTRADO: 404,
  CAMPOS_NO_EDITABLES: 422,
};

export const PATCH = withPermission(
  PERMISO_EDITAR,
  async (req: NextRequest, session, rawContext) => {
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
    const parsed = EditarProveedorSchema.safeParse(body);
    if (!parsed.success) {
      // `cuit`/`estado` en el payload → 422 CAMPOS_NO_EDITABLES (D7), no un
      // 400 genérico: el cliente necesita distinguir el motivo del rechazo.
      if (esErrorCamposNoEditables(parsed.error)) {
        return NextResponse.json(
          {
            data: null,
            error: {
              code: "CAMPOS_NO_EDITABLES",
              message: "El CUIT y el estado del proveedor no se pueden editar en el legajo",
            },
          },
          { status: 422 },
        );
      }
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
      const resultado = await editarProveedor(
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
      console.error("[PATCH /api/proveedores/[id]] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);