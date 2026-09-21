/**
 * @module route — PATCH /api/clientes/[id]
 * @description HU-C2 — Edición de los datos de contacto de un cliente
 * (`nombre`, `telefono`, `email`). Wrapper fino (spec §1): resuelve sesión +
 * permiso granular `clientes:editar`, valida el body con Zod, delega en
 * `editarCliente()` y mapea el resultado/excepción al shape `{ data, error }`.
 * NINGUNA regla de negocio vive acá.
 *
 * `dni` NO es editable: el schema lo rechaza vía `superRefine` y este wrapper
 * distingue ese caso para responder `422 CAMPOS_NO_EDITABLES` en vez de un
 * `400 VALIDATION_ERROR` genérico (mismo patrón que `PATCH /api/proveedores/[id]`).
 * `cliente_id` llega SIEMPRE por el path param `[id]`.
 *
 * PATCH — 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 *         404 CLIENTE_NO_ENCONTRADO (inexistente o inactivo) ·
 *         422 CAMPOS_NO_EDITABLES · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  EditarClienteSchema,
  esErrorClienteCamposNoEditables,
} from "@/lib/schemas/clientes.schema";
import { editarCliente, PERMISO_EDITAR } from "@/lib/services/clientes/cliente.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CLIENTE_NO_ENCONTRADO: 404,
  CAMPOS_NO_EDITABLES: 422,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const PATCH = withPermission(
  PERMISO_EDITAR,
  async (req: NextRequest, session, rawContext) => {
    // Next.js 16: `params` es una Promise (se espera, no se asume shape).
    const { id } = await (rawContext as Context).params;

    const body = await req.json().catch(() => null);
    const parsed = EditarClienteSchema.safeParse(body);
    if (!parsed.success) {
      if (esErrorClienteCamposNoEditables(parsed.error)) {
        return errorJson("CAMPOS_NO_EDITABLES", "El DNI de un cliente no se puede editar", 422);
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
      const resultado = await editarCliente(id, parsed.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      // Nunca se filtra el detalle de la DB ni el stack al cliente.
      console.error("[PATCH /api/clientes/[id]] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
