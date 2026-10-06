import { notFound, redirect } from "next/navigation";
import { DetallePedidoWeb } from "@/components/ecommerce/DetallePedidoWeb";
import { getSesionClienteWeb, getSesionClienteWebVinculada } from "@/lib/auth/sesion-cliente-web";
import { ServiceError } from "@/lib/errors/service-error";
import { PedidoWebIdSchema } from "@/lib/schemas/mis-pedidos.schema";
import { obtenerPedidoWebCliente } from "@/lib/services/ecommerce/mis-pedidos.service";

type Context = { params: Promise<{ id: string }> };

export default async function DetallePedidoPage({ params }: Context) {
  const { id: rawId } = await params;
  const sesionActual = await getSesionClienteWeb();
  if (sesionActual?.vinculacionPendiente) redirect("/tienda/cuenta");
  const sesion = await getSesionClienteWebVinculada();
  if (!sesion) redirect(`/tienda/ingresar?redirect=${encodeURIComponent(`/tienda/cuenta/pedidos/${rawId}`)}`);

  const pedidoId = PedidoWebIdSchema.safeParse(rawId);
  if (!pedidoId.success) notFound();

  const resultado = await obtenerPedidoWebCliente(sesion.clienteId, pedidoId.data)
    .then((pedido) => ({ pedido, error: null }))
    .catch((error: unknown) => ({ pedido: null, error }));
  if (resultado.error instanceof ServiceError && resultado.error.code === "PEDIDO_NO_ENCONTRADO") notFound();
  if (resultado.error) return <DetallePedidoWeb pedido={null} estado="error" />;
  return <DetallePedidoWeb pedido={resultado.pedido} />;
}
