import { withSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { PedidoWebIdSchema } from "@/lib/schemas/mis-pedidos.schema";
import { obtenerPedidoWebCliente } from "@/lib/services/ecommerce/mis-pedidos.service";
import { conCachePrivada, respuestaMisPedidosError, respuestaMisPedidosOk, respuestaMisPedidosValidacion } from "../http";

type Context = { params: Promise<{ id: string }> };

const guardedHandler = withSesionClienteWeb<Context>(async (_req, sesion, context) => {
  const input = PedidoWebIdSchema.safeParse((await context.params).id);
  if (!input.success) return respuestaMisPedidosValidacion(input.error);

  try {
    return respuestaMisPedidosOk(await obtenerPedidoWebCliente(sesion.clienteId, input.data));
  } catch (error) {
    return respuestaMisPedidosError(error, "GET /api/tienda/mis-pedidos/[id]");
  }
});

export const GET = conCachePrivada(guardedHandler);
