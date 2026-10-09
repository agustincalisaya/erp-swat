import { NextResponse, type NextRequest } from "next/server";
import { withSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { CancelarPedidoPagadoSchema, PedidoVentaReintegroIdSchema } from "@/lib/schemas/reintegro-pedido-web.schema";
import { iniciarReintegroPedidoWebPaso0 } from "@/lib/services/ecommerce/reintegro-pedido-web.service";
import { continuarRefundPedidoWeb } from "@/lib/services/ecommerce/reintegro-refund.service";
import { conCachePrivada, respuestaMisPedidosValidacion } from "../../http";

type Context = { params: Promise<{ id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  PEDIDO_NO_ENCONTRADO: 404,
  TRANSICION_INVALIDA: 409,
  REINTEGRO_INCONSISTENTE: 409,
  EVIDENCIA_PAGO_INCONSISTENTE: 409,
  EVIDENCIA_FISCAL_INCONSISTENTE: 409,
  EVIDENCIA_STOCK_INCONSISTENTE: 409,
};

const handler = withSesionClienteWeb<Context>(async (req: NextRequest, sesion, context) => {
  const id = PedidoVentaReintegroIdSchema.safeParse((await context.params).id);
  if (!id.success) return respuestaMisPedidosValidacion(id.error);
  const body = CancelarPedidoPagadoSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return respuestaMisPedidosValidacion(body.error);

  try {
    const inicio = await iniciarReintegroPedidoWebPaso0({
      pedido_venta_id: id.data,
      causa: "CANCELACION_CLIENTE",
      cliente_web_cuenta_id: sesion.cuentaId,
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
      console.error("[PATCH /api/tienda/mis-pedidos/[id]/cancelar] El reintegro continuará por la saga");
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
      const publico = error.code === "PEDIDO_NO_ENCONTRADO"
        ? { code: "PEDIDO_NO_ENCONTRADO", message: "El pedido solicitado no existe" }
        : { code: error.code, message: error.message };
      return NextResponse.json({ data: null, error: publico }, { status: STATUS_POR_CODIGO[error.code] });
    }
    console.error("[PATCH /api/tienda/mis-pedidos/[id]/cancelar] Error inesperado");
    return NextResponse.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
});

export const PATCH = conCachePrivada(handler);
