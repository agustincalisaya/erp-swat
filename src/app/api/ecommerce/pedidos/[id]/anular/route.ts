/**
 * HU-E7 — PATCH: anulación manual de una orden web no abonada (spec E §2.7;
 * task_relos.md D1–D12). `[id]` = `pedido_venta_id`. Solo PAGO_PENDIENTE o
 * PAGO_RECHAZADO; baja lógica, nunca DELETE. El actor sale de la sesión.
 *
 * Respuestas `{ data, error }`: 200 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PEDIDO_WEB_NO_ENCONTRADO · 409 TRANSICION_INVALIDA ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISO_ANULAR_ORDEN_NO_ABONADA } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { AnularOrdenNoAbonadaSchema, PedidoVentaIdSchema } from "@/lib/schemas/ecommerce.schema";
import { anularOrdenNoAbonada } from "@/lib/services/ecommerce/anulacion-orden.service";
import {
  leerJsonCatalogo,
  respuestaOkCatalogo,
  respuestaValidacionCatalogo,
} from "@/lib/services/ecommerce/respuesta-catalogo";

type Contexto = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PEDIDO_WEB_NO_ENCONTRADO: 404,
  TRANSICION_INVALIDA: 409,
};

export const PATCH = withPermission(PERMISO_ANULAR_ORDEN_NO_ABONADA, async (req: NextRequest, session, context) => {
  const id = PedidoVentaIdSchema.safeParse((await (context as Contexto).params).id);
  if (!id.success) return respuestaValidacionCatalogo(id.error);
  const input = AnularOrdenNoAbonadaSchema.safeParse(await leerJsonCatalogo(req));
  if (!input.success) return respuestaValidacionCatalogo(input.error);
  try {
    return respuestaOkCatalogo(await anularOrdenNoAbonada(id.data, session.userId, input.data.deletion_reason));
  } catch (error) {
    if (error instanceof ServiceError && STATUS_POR_CODIGO[error.code]) {
      return NextResponse.json(
        { data: null, error: { code: error.code, message: error.message } },
        { status: STATUS_POR_CODIGO[error.code] },
      );
    }
    console.error("[PATCH /api/ecommerce/pedidos/[id]/anular] Error inesperado:", {
      tipo_error: error instanceof Error ? error.name : "desconocido",
    });
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
