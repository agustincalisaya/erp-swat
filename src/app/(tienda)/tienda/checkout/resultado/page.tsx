/**
 * @page CheckoutResultadoTienda
 * @route /tienda/checkout/resultado?pedido=<pedido_venta_id>
 * @description HU-E2 — página de retorno de Mercado Pago (`back_urls` de
 * Checkout Pro). El estado se lee SIEMPRE de la base: los parámetros que
 * agrega Mercado Pago a la URL (`status`, `payment_id`, …) se ignoran, porque
 * los puede escribir cualquiera. La confirmación real la hace el webhook (CA2).
 * Solo se muestra si el pedido es del cliente de la sesión (spec E §2.9).
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSesionClienteWeb, getSesionClienteWebVinculada } from "@/lib/auth/sesion-cliente-web";
import { obtenerResultadoPago } from "@/lib/services/ecommerce/pago-web.service";
import { CheckoutResultadoVista } from "../CheckoutResultadoVista";

const PedidoIdSchema = z.string().uuid();

export default async function CheckoutResultadoTiendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { pedido: pedidoParam } = await searchParams;
  const pedidoId = PedidoIdSchema.safeParse(pedidoParam);

  const sesionActual = await getSesionClienteWeb();
  if (sesionActual?.vinculacionPendiente) redirect("/tienda/cuenta");
  const sesion = await getSesionClienteWebVinculada();
  if (!sesion) {
    const volver = pedidoId.success ? `/tienda/checkout/resultado?pedido=${pedidoId.data}` : "/tienda/carrito";
    redirect(`/tienda/ingresar?redirect=${encodeURIComponent(volver)}`);
  }

  const pedido = pedidoId.success ? await obtenerResultadoPago(pedidoId.data, sesion.clienteId) : null;
  return <CheckoutResultadoVista pedido={pedido} />;
}
