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
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { DesgloseCupon } from "@/components/tienda/DesgloseCupon";
import { formatearPrecio } from "@/components/tienda/formato";
import { getSesionClienteWeb, getSesionClienteWebVinculada } from "@/lib/auth/sesion-cliente-web";
import { obtenerPedidoWebPendiente } from "@/lib/services/ecommerce/checkout.service";
import { obtenerOCrearPreferencia, obtenerResultadoPago } from "@/lib/services/ecommerce/pago-web.service";
import { z } from "zod";

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

const volverAlCatalogo = (
  <Link href="/tienda/catalogo" className={buttonVariants({ variant: "outline" })}>
    Volver al catálogo
  </Link>
);

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

  const pedido = pedidoId.success ? await obtenerPedidoWebPendiente(pedidoId.data, sesion.clienteId) : null;

  // HU-E2: si el pedido ya se pagó o se rechazó, su estado está en la página de resultado.
  if (!pedido && pedidoId.success && (await obtenerResultadoPago(pedidoId.data, sesion.clienteId))) {
    redirect(`/tienda/checkout/resultado?pedido=${pedidoId.data}`);
  }

  if (!pedido) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Alert>
          <AlertTitle>No encontramos esa compra pendiente</AlertTitle>
          <AlertDescription>Agregá productos al carrito para iniciar una compra.</AlertDescription>
        </Alert>
        {volverAlCatalogo}
      </div>
    );
  }

  const vencimiento = formatoHora.format(new Date(pedido.ttl_expiracion));

  if (pedido.estado_visible === "RESERVA_VENCIDA") {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">Reserva vencida</h1>
        <Alert variant="destructive">
          <AlertTitle>Pedido {pedido.numero_venta} — Reserva vencida</AlertTitle>
          <AlertDescription>
            El pago no se confirmó antes de las {vencimiento}: la reserva venció y los artículos volvieron a estar
            disponibles. Podés armar el carrito de nuevo e iniciar otra compra.
          </AlertDescription>
        </Alert>
        {volverAlCatalogo}
      </div>
    );
  }

  const checkoutUrl = await urlDePago(pedido.pedido_venta_ecommerce_id, pedido.checkout_url);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">Reservamos tu compra</h1>
      <Alert>
        <AlertTitle>Pedido {pedido.numero_venta} — Pago pendiente</AlertTitle>
        <AlertDescription>
          Total {formatearPrecio(pedido.total)}. Los artículos quedan reservados hasta las <strong>{vencimiento}</strong>.
          Si el pago no se confirma antes, la reserva vence y el stock vuelve a estar disponible.
        </AlertDescription>
      </Alert>
      {pedido.cupon && <DesgloseCupon cupon={pedido.cupon} total={pedido.total} />}
      {checkoutUrl ? (
        <>
          {/* Checkout Pro: la tarjeta se carga en Mercado Pago, nunca en SWAT (CA1). */}
          <a href={checkoutUrl} className={buttonVariants({ className: "w-full" })}>
            Pagar con Mercado Pago
          </a>
          <p className="text-xs text-slate-600">
            Vas a pagar en el sitio de Mercado Pago. Tus datos de tarjeta nunca pasan por SWAT Indumentarias.
          </p>
        </>
      ) : (
        <Alert variant="destructive">
          <AlertTitle>No pudimos conectar con Mercado Pago</AlertTitle>
          <AlertDescription>
            Tu reserva sigue vigente. <Link href={`/tienda/checkout/pendiente?pedido=${pedido.pedido_venta_id}`}>Reintentá</Link>{" "}
            en unos segundos.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
