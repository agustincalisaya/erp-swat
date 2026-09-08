/**
 * @module route — /api/ordenes-compra/[id]/comprobantes
 * @description HU-H9 §2.7 — Alta (`POST`) y listado por OC (`GET`) de
 * Comprobantes de Proveedor. Wrappers finos (spec §1): resuelven sesión +
 * permiso granular, validan id de path + body con Zod, delegan en
 * `comprobante-proveedor.service.ts` y mapean el resultado/excepción al
 * shape `{ data, error }`. NINGUNA regla de negocio vive acá.
 *
 * `orden_compra_id` llega SIEMPRE por el path param `[id]` — nunca en el body
 * (spec §2.7). `proveedor_id` lo resuelve el servicio server-side.
 *
 * POST — 201 Created · 400 VALIDATION_ERROR · 401 · 403 ·
 *        404 ORDEN_NO_ENCONTRADA · 409 ORDEN_NO_RECEPCIONADA /
 *        COMPROBANTE_DUPLICADO · 500.
 * GET  — 200 OK · 400 · 401 · 403 · 500.
 */
import { NextResponse, type NextRequest } from "next/server";
import { usuarioTienePermiso, withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  ComprobanteOrdenCompraIdSchema,
  RegistrarComprobanteProveedorSchema,
} from "@/lib/schemas/comprobantes-proveedor.schema";
import {
  listarComprobantesPorOrdenCompra,
  registrarComprobanteProveedor,
  PERMISO_CREAR,
  PERMISO_LEER,
} from "@/lib/services/proveedores/comprobante-proveedor.service";

type Context = { params: Promise<{ id: string }> };

/** Ver a un comprobante anulado en el listado es privilegio de Auditoría (RULES.md Regla N.° 1). */
const PERMISO_AUDITORIA = "auditoria:leer_forense";

const STATUS_POR_CODIGO: Record<string, number> = {
  ORDEN_NO_ENCONTRADA: 404,
  ORDEN_NO_RECEPCIONADA: 409,
  COMPROBANTE_DUPLICADO: 409,
};

function idInvalido(mensaje: string): NextResponse {
  return NextResponse.json(
    { data: null, error: { code: "VALIDATION_ERROR", message: mensaje } },
    { status: 400 },
  );
}

export const POST = withPermission(
  PERMISO_CREAR,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = ComprobanteOrdenCompraIdSchema.safeParse(id);
    if (!parsedId.success) {
      return idInvalido(parsedId.error.issues[0]?.message ?? "ID inválido");
    }

    const body = await req.json().catch(() => null);
    const parsed = RegistrarComprobanteProveedorSchema.safeParse(body);
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
      const resultado = await registrarComprobanteProveedor(
        parsedId.data,
        parsed.data,
        session.userId,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 201 });
    } catch (error) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status: STATUS_POR_CODIGO[error.code] ?? 400 },
        );
      }
      console.error("[POST /api/ordenes-compra/[id]/comprobantes] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);

export const GET = withPermission(
  PERMISO_LEER,
  async (_req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = ComprobanteOrdenCompraIdSchema.safeParse(id);
    if (!parsedId.success) {
      return idInvalido(parsedId.error.issues[0]?.message ?? "ID inválido");
    }

    try {
      const incluirAnulados = await usuarioTienePermiso(session.userId, PERMISO_AUDITORIA);
      const resultado = await listarComprobantesPorOrdenCompra(parsedId.data, {
        incluirAnulados,
      });
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (error) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status: 400 },
        );
      }
      console.error("[GET /api/ordenes-compra/[id]/comprobantes] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
