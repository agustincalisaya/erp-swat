import { withSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { MisPedidosQuerySchema } from "@/lib/schemas/mis-pedidos.schema";
import { listarPedidosWebCliente } from "@/lib/services/ecommerce/mis-pedidos.service";
import { conCachePrivada, respuestaMisPedidosError, respuestaMisPedidosOk, respuestaMisPedidosValidacion } from "./http";

const guardedHandler = withSesionClienteWeb(async (req, sesion) => {
  const input = MisPedidosQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!input.success) return respuestaMisPedidosValidacion(input.error);

  try {
    const resultado = await listarPedidosWebCliente(sesion.clienteId, {
      pagina: input.data.page,
      porPagina: input.data.page_size,
    });
    return respuestaMisPedidosOk(resultado);
  } catch (error) {
    return respuestaMisPedidosError(error, "GET /api/tienda/mis-pedidos");
  }
});

export const GET = conCachePrivada(guardedHandler);
