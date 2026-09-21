/**
 * @module route — PATCH /api/clientes/[id]/canal-contacto
 * @description HU-C9 §2.3 — Actualización del canal de contacto preferido
 * (`canal_preferido`: WhatsApp / Email / Ambos) de un cliente. Wrapper fino
 * (spec §1): resuelve sesión + permiso granular, valida el body con Zod,
 * delega en `cliente.service.ts` y mapea el resultado/excepción al shape
 * `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * `cliente_id` llega SIEMPRE por el path param `[id]` — NUNCA en el body
 * (spec §2.3). Un `cliente_id` espurio en el payload se descarta
 * silenciosamente en el parseo (el schema no es `.strict()`), y este handler
 * jamás lo lee: el único cliente posible es el del path.
 *
 * PATCH — 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 *         403 FORBIDDEN · 404 CLIENTE_NO_ENCONTRADO (inexistente o inactivo)
 *         · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ActualizarCanalContactoSchema } from "@/lib/schemas/clientes.schema";
import {
  actualizarCanalContacto,
  PERMISO_EDITAR,
} from "@/lib/services/clientes/cliente.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CLIENTE_NO_ENCONTRADO: 404,
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
    const parsed = ActualizarCanalContactoSchema.safeParse(body);
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
      const resultado = await actualizarCanalContacto(id, parsed.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      // Nunca se filtra el detalle de la DB ni el stack al cliente.
      console.error("[PATCH /api/clientes/[id]/canal-contacto] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
