import { NextResponse, type NextRequest } from "next/server";
import { PERMISO_CANCELAR_PEDIDO_PAGADO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { CancelarPedidoPagadoSchema, PedidoVentaReintegroIdSchema } from "@/lib/schemas/reintegro-pedido-web.schema";
import { iniciarReintegroPedidoWebPaso0 } from "@/lib/services/ecommerce/reintegro-pedido-web.service";
import { continuarRefundPedidoWeb } from "@/lib/services/ecommerce/reintegro-refund.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PEDIDO_NO_ENCONTRADO: 404,
  TRANSICION_INVALIDA: 409,
  REINTEGRO_INCONSISTENTE: 409,
  EVIDENCIA_PAGO_INCONSISTENTE: 409,
  EVIDENCIA_FISCAL_INCONSISTENTE: 409,
  EVIDENCIA_STOCK_INCONSISTENTE: 409,
};

export const PATCH = withPermission(PERMISO_CANCELAR_PEDIDO_PAGADO, async (req: NextRequest, session, context) => {
  const id = PedidoVentaReintegroIdSchema.safeParse((await (context as Context).params).id);
  if (!id.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos" } },
      { status: 400 },
    );
  }
  const body = CancelarPedidoPagadoSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos" } },
      { status: 400 },
    );
  }

  try {
    const inicio = await iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: id.data,
      causa: "CANCELACION_ADMIN",
      usuario_id: session.userId,
      motivo: body.data.motivo,
    });
    try {
      const reintegro = await prisma.reintegroPedidoWeb.findUniqueOrThrow({
        where: { id: inicio.reintegro_id },
        select: { estado: true, _count: { select: { intentos_refund: true } } },
      });
      if (reintegro.estado === "PENDIENTE" && reintegro._count.intentos_refund === 0) {
        await continuarRefundPedidoWeb(inicio.reintegro_id);
      }
    } catch {
      console.error("[PATCH /api/ecommerce/pedidos/[id]/cancelar] El reintegro continuará por la saga");
    }
    return NextResponse.json({
      data: {
        pedido_venta_id: inicio.pedido_venta_id,
        estado_ecommerce: inicio.estado_ecommerce,
        reintegro_iniciado: true,
      },
      error: null,
    });
  } catch (error) {
    if (error instanceof ServiceError && STATUS_POR_CODIGO[error.code]) {
      return NextResponse.json(
        { data: null, error: { code: error.code, message: error.message } },
        { status: STATUS_POR_CODIGO[error.code] },
      );
    }
    console.error("[PATCH /api/ecommerce/pedidos/[id]/cancelar] Error inesperado");
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
