/**
 * @module route — PATCH /api/clientes/[id]/direcciones/[direccionId]
 * @description HU-C2 — Edición de una dirección existente de un cliente
 * (`rotulo`, `tipo`, `direccion_completa`). Wrapper fino (spec §1): resuelve
 * sesión + permiso granular `clientes:editar`, valida el body con Zod, delega
 * en `editarDireccionCliente()` y mapea el resultado/excepción al shape
 * `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * `cliente_id` y `direccion_id` llegan SIEMPRE por los path params — NUNCA en
 * el body. La regla de FACTURACION (no dejar al cliente con envíos y sin
 * facturación) la aplica el service.
 *
 * PATCH — 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 *         404 CLIENTE_NO_ENCONTRADO / DIRECCION_NO_ENCONTRADA ·
 *         422 DIRECCION_FACTURACION_REQUERIDA · 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { EditarDireccionClienteSchema } from "@/lib/schemas/clientes.schema";
import {
  editarDireccionCliente,
  PERMISO_EDITAR,
} from "@/lib/services/clientes/cliente.service";

type Context = { params: Promise<{ id: string; direccionId: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CLIENTE_NO_ENCONTRADO: 404,
  DIRECCION_NO_ENCONTRADA: 404,
  DIRECCION_FACTURACION_REQUERIDA: 422,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const PATCH = withPermission(
  PERMISO_EDITAR,
  async (req: NextRequest, session, rawContext) => {
    // Next.js 16: `params` es una Promise (se espera, no se asume shape).
    const { id, direccionId } = await (rawContext as Context).params;

    const body = await req.json().catch(() => null);
    const parsed = EditarDireccionClienteSchema.safeParse(body);
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
      const resultado = await editarDireccionCliente(id, direccionId, parsed.data, session.userId);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      // Nunca se filtra el detalle de la DB ni el stack al cliente.
      console.error("[PATCH /api/clientes/[id]/direcciones/[direccionId]] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
