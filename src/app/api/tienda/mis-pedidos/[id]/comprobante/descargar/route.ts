import { NextResponse } from "next/server";
import { withSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { PedidoWebIdSchema } from "@/lib/schemas/mis-pedidos.schema";
import { generarComprobanteWebPdf } from "@/lib/services/ecommerce/comprobante-web-pdf";
import { obtenerComprobanteOriginalWebCliente } from "@/lib/services/ecommerce/mis-pedidos.service";
import { conCachePrivada, respuestaMisPedidosError } from "../../../http";
import { respuestaComprobantePdf } from "./response";

type Context = { params: Promise<{ id: string }> };
const ruta = "GET /api/tienda/mis-pedidos/[id]/comprobante/descargar";

function noEncontrado(): NextResponse {
  return NextResponse.json(
    { data: null, error: { code: "PEDIDO_NO_ENCONTRADO", message: "El pedido solicitado no existe" } },
    { status: 404 },
  );
}

const handler = withSesionClienteWeb<Context>(async (_req, sesion, context) => {
  const id = PedidoWebIdSchema.safeParse((await context.params).id);
  if (!id.success) return noEncontrado();

  try {
    const comprobante = await obtenerComprobanteOriginalWebCliente(sesion.clienteId, id.data);
    const pdf = await generarComprobanteWebPdf(comprobante);
    return respuestaComprobantePdf(pdf, comprobante.numero);
  } catch (error) {
    return respuestaMisPedidosError(error, ruta);
  }
});

export const GET = conCachePrivada(handler);
