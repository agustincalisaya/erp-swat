/**
 * @module route — PATCH /api/proveedores/[id]/baja
 * @description HU-H1 — Baja lógica del registro de proveedor (Regla N.° 1:
 * NUNCA un DELETE físico). Wrapper fino (spec §1): resuelve sesión + permiso
 * granular `proveedores:baja` (solo Supervisor de Compras — matriz Alcance
 * §5), valida el id y el `deletion_reason` con Zod, delega en
 * `darDeBajaProveedor()` y mapea el resultado/excepción.
 *
 * El verbo es PATCH (no DELETE): DELETE con body falla en proxies intermedios
 * y es semánticamente engañoso para una baja lógica (decisión D4 ratificada
 * en la fase propose).
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PROVEEDOR_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import {
  DarDeBajaProveedorSchema,
  ProveedorIdSchema,
} from "@/lib/schemas/proveedores.schema";
import {
  darDeBajaProveedor,
  PERMISO_BAJA,
} from "@/lib/services/proveedores/proveedor.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PROVEEDOR_NO_ENCONTRADO: 404,
};

export const PATCH = withPermission(
  PERMISO_BAJA,
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
    const parsed = DarDeBajaProveedorSchema.safeParse(body);
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
      const resultado = await darDeBajaProveedor(
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
      console.error("[PATCH /api/proveedores/[id]/baja] Error inesperado:", err);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);