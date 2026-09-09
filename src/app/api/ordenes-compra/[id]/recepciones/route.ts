import { NextResponse, type NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { OrdenCompraIdSchema } from "@/lib/schemas/ordenes-compra.schema";
import { RegistrarRecepcionSchema } from "@/lib/schemas/recepciones.schema";
import {
  PERMISO_REGISTRAR_RECEPCION,
  registrarRecepcion,
} from "@/lib/services/proveedores/recepcion.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  ORDEN_NO_ENCONTRADA: 404,
  DEPOSITO_NO_ENCONTRADO: 404,
  ORDEN_NO_RECEPCIONABLE: 409,
  CLAVE_IDEMPOTENCIA_REUTILIZADA: 409,
  CONFLICTO_CONCURRENCIA: 409,
  ORDEN_SIN_ITEMS_RECEPCIONABLES: 422,
};

export const POST = withPermission(
  PERMISO_REGISTRAR_RECEPCION,
  async (req: NextRequest, session, rawContext) => {
    const { id } = await (rawContext as Context).params;
    const parsedId = OrdenCompraIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message } },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = RegistrarRecepcionSchema.safeParse(body);
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
      const resultado = await registrarRecepcion(
        { ...parsed.data, orden_compra_id: parsedId.data },
        session.userId,
      );
      return NextResponse.json(
        { data: resultado, error: null },
        { status: resultado.idempotente ? 200 : 201 },
      );
    } catch (error) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: error.code, message: error.message } },
          { status: STATUS_POR_CODIGO[error.code] ?? 400 },
        );
      }
      console.error("[POST /api/ordenes-compra/[id]/recepciones] Error inesperado:", error);
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
