/**
 * @page CheckoutPendienteTienda
 * @route /tienda/checkout/pendiente?pedido=<pedido_venta_id>
 * @description HU-E1 (D1/CA5) — estado del pedido que DEVOLVIÓ el checkout
 * (por id, no "el último pendiente de la cuenta": con la regla D10 por carrito
 * una cuenta puede tener varios pedidos Pago Pendiente). El id viaja en la URL
 * pero solo se muestra si el pedido es del cliente de la sesión; uno ajeno o
 * inexistente se trata igual que "no encontrado" (spec E §2.9).
 *
 *  - Reserva vigente → "Pago pendiente" con el vencimiento.
 *  - Reserva vencida → "Reserva vencida", DERIVADO de `ttl_expiracion` sin
 *    escribir en la base: el pedido sigue PAGO_PENDIENTE hasta que HU-E7 lo
 *    anule (coordinación pendiente, docs/tasks/HU-E1.md).
 *
 * HU-E2: con la reserva vigente muestra "Pagar con Mercado Pago" (Checkout
 * Pro, redirect al `checkout_url`). Si el pedido todavía no tiene preferencia
 * (Mercado Pago falló al iniciar la compra) la crea acá; si vuelve a fallar,
 * se ofrece reintentar recargando.
 *
 * HU-E15 (E15-7): si el job de TTL ya anuló el pedido (HU-E7), las lecturas
 * anteriores no lo encuentran (extensión dada de baja); una lectura acotada
 * (`obtenerPedidoWebVencidoPorTtl`) lo vuelve a mostrar como "Reserva vencida".
 */
import { redirect } from "next/navigation";
import { getSesionClienteWeb, getSesionClienteWebVinculada } from "@/lib/auth/sesion-cliente-web";
import { obtenerPedidoWebPendiente, obtenerPedidoWebVencidoPorTtl } from "@/lib/services/ecommerce/checkout.service";
import { obtenerOCrearPreferencia, obtenerResultadoPago } from "@/lib/services/ecommerce/pago-web.service";
import { obtenerUsuarioCanalWebId } from "@/lib/services/ecommerce/usuario-canal-web";
import { z } from "zod";
import { CheckoutPendienteVista } from "../CheckoutPendienteVista";

/** HU-E2: `checkout_url` del pedido, creándolo si falta. `null` si MP no respondió. */
async function urlDePago(pedidoVentaEcommerceId: string, guardada: string | null): Promise<string | null> {
  if (guardada) return guardada;
  try {
    return await obtenerOCrearPreferencia(pedidoVentaEcommerceId);
  } catch (error) {
    console.error("[tienda/checkout/pendiente] No se pudo crear la preferencia de pago:", error);
    return null;
  }
}

const formatoHora = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Salta",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

const PedidoIdSchema = z.string().uuid();

export default async function CheckoutPendienteTiendaPage({
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
    const volver = pedidoId.success ? `/tienda/checkout/pendiente?pedido=${pedidoId.data}` : "/tienda/carrito";
    redirect(`/tienda/ingresar?redirect=${encodeURIComponent(volver)}`);
  }

  let pedido = pedidoId.success ? await obtenerPedidoWebPendiente(pedidoId.data, sesion.clienteId) : null;

  // HU-E2: si el pedido ya se pagó o se rechazó, su estado está en la página de resultado.
  if (!pedido && pedidoId.success && (await obtenerResultadoPago(pedidoId.data, sesion.clienteId))) {
    redirect(`/tienda/checkout/resultado?pedido=${pedidoId.data}`);
  }

  // HU-E15 (E15-7): anulado por el job de TTL → "Reserva vencida", no "no encontrado".
  if (!pedido && pedidoId.success) {
    pedido = await obtenerPedidoWebVencidoPorTtl(pedidoId.data, sesion.clienteId, await obtenerUsuarioCanalWebId());
  }

  if (!pedido) {
    return <CheckoutPendienteVista pedido={null} vencimiento={null} checkoutUrl={null} />;
  }

  const vencimiento = formatoHora.format(new Date(pedido.ttl_expiracion));

  if (pedido.estado_visible === "RESERVA_VENCIDA") {
    return <CheckoutPendienteVista pedido={pedido} vencimiento={vencimiento} checkoutUrl={null} />;
  }

  const checkoutUrl = await urlDePago(pedido.pedido_venta_ecommerce_id, pedido.checkout_url);
  return <CheckoutPendienteVista pedido={pedido} vencimiento={vencimiento} checkoutUrl={checkoutUrl} />;
}
