import { NextResponse, type NextRequest } from "next/server";
import { PERMISO_CANCELAR_PEDIDO_PAGADO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { PedidoVentaReintegroIdSchema, ReintentarRefundSchema } from "@/lib/schemas/reintegro-pedido-web.schema";
import { solicitarReintentoManualRefund } from "@/lib/services/ecommerce/reintegro-refund.service";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  REINTEGRO_NO_ENCONTRADO: 404,
  REINTEGRO_EN_PROCESO: 409,
  REINTEGRO_NO_RECHAZADO: 409,
  REINTEGRO_APROBADO: 409,
  REINTEGRO_INCONSISTENTE: 409,
  REFUND_ID_INCONSISTENTE: 409,
};

export const POST = withPermission(PERMISO_CANCELAR_PEDIDO_PAGADO, async (req: NextRequest, session, context) => {
  const id = PedidoVentaReintegroIdSchema.safeParse((await (context as Context).params).id);
  if (!id.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos" } },
      { status: 400 },
    );
  }
  const body = ReintentarRefundSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos" } },
      { status: 400 },
    );
  }

  try {
    const reintegro = await prisma.reintegroPedidoWeb.findUnique({
      where: { pedido_venta_id: id.data },
      select: { id: true },
    });
    if (!reintegro) throw new ServiceError("REINTEGRO_NO_ENCONTRADO", "El reintegro no existe");
    const resultado = await solicitarReintentoManualRefund({
      reintegro_id: reintegro.id,
      usuario_id: session.userId,
      motivo: body.data.motivo,
    });
    return NextResponse.json({
      data: {
        pedido_venta_id: id.data,
        reintegro_id: resultado.reintegro_id,
        intento_id: "intento_id" in resultado ? resultado.intento_id : null,
        resultado: resultado.resultado,
        intento_reutilizado: resultado.intento_reutilizado,
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
    console.error("[POST /api/ecommerce/pedidos/[id]/reintegro/reintentar] Error inesperado");
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});
