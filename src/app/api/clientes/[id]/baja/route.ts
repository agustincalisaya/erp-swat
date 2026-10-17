/**
 * @module route — PATCH /api/clientes/[id]/baja
 * @description HU-C6 §2.6 — Baja lógica de un cliente (Regla N.° 1: NUNCA un
 * DELETE físico). Wrapper fino (spec §1): resuelve sesión + permiso granular
 * `clientes:baja` (solo Administrador de CRM — el Vendedor recibe 403 por
 * RBAC), valida el body con Zod, delega en `bajaCliente()` y mapea el
 * resultado/excepción. NINGUNA regla de negocio vive acá.
 *
 * El verbo es PATCH (no DELETE): DELETE con body falla en proxies intermedios
 * y es semánticamente engañoso para una baja lógica (mismo criterio que
 * `PATCH /api/proveedores/[id]/baja`).
 *
 * `cliente_id` llega SIEMPRE por el path param `[id]` — NUNCA en el body.
 *
 * PATCH — 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 *         404 CLIENTE_NO_ENCONTRADO (inexistente o ya dado de baja) ·
 *         500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { BajaClienteSchema } from "@/lib/schemas/clientes.schema";
import { bajaCliente, PERMISO_BAJA } from "@/lib/services/clientes/cliente.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  CLIENTE_NO_ENCONTRADO: 404,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const PATCH = withPermission(
  PERMISO_BAJA,
  async (req: NextRequest, session, rawContext) => {
    // Next.js 16: `params` es una Promise (se espera, no se asume shape).
    const { id } = await (rawContext as Context).params;

    const body = await req.json().catch(() => null);
    const parsed = BajaClienteSchema.safeParse(body);
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
      const resultado = await bajaCliente(id, session.userId, parsed.data.deletion_reason);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code] ?? 400);
      }
      // Nunca se filtra el detalle de la DB ni el stack al cliente.
      console.error("[PATCH /api/clientes/[id]/baja] Error inesperado:", err);
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
