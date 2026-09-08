/**
 * @module route — PATCH /api/comprobantes-proveedor/[id]/anular
 * @description HU-H9 §2.7 / §3.6 — Anulación (baja lógica) de un
 * ComprobanteProveedor. Wrapper fino (spec §1): resuelve sesión + permiso
 * granular `comprobantes_proveedor:anular` (EXCLUSIVO Supervisor de Compras,
 * spec §2.7), valida el id de path + el `deletion_reason` con Zod, delega en
 * `anularComprobanteProveedor()` y mapea el resultado/excepción.
 *
 * El verbo es PATCH (no DELETE): es una baja lógica, la fila se conserva
 * consultable (RULES.md Regla N.° 1). El comprobante es inmutable — esta es
 * la única mutación admitida post-alta.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 COMPROBANTE_NO_ENCONTRADO · 409 COMPROBANTE_YA_ANULADO ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  AnularComprobanteProveedorSchema,
  ComprobanteProveedorIdSchema,
} from "@/lib/schemas/comprobantes-proveedor.schema";
import {
  anularComprobanteProveedor,
  PERMISO_ANULAR,
} from "@/lib/services/proveedores/comprobante-proveedor.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  COMPROBANTE_NO_ENCONTRADO: 404,
  COMPROBANTE_YA_ANULADO: 409,
};

export const PATCH = withPermission(
  PERMISO_ANULAR,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = ComprobanteProveedorIdSchema.safeParse(id);
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
    const parsed = AnularComprobanteProveedorSchema.safeParse(body);
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
      const resultado = await anularComprobanteProveedor(
        parsedId.data,
        parsed.data,
        session.userId,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (error) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status: STATUS_POR_CODIGO[error.code] ?? 400 },
        );
      }
      console.error("[PATCH /api/comprobantes-proveedor/[id]/anular] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
