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
 * El pago (Mercado Pago) llega con HU-E2.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { formatearPrecio } from "@/components/tienda/formato";
import { getSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { obtenerPedidoWebPendiente } from "@/lib/services/ecommerce/checkout.service";
import { z } from "zod";

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

  const sesion = await getSesionClienteWeb();
  if (!sesion) {
    const volver = pedidoId.success ? `/tienda/checkout/pendiente?pedido=${pedidoId.data}` : "/tienda/carrito";
    redirect(`/tienda/ingresar?redirect=${encodeURIComponent(volver)}`);
  }

  const pedido = pedidoId.success ? await obtenerPedidoWebPendiente(pedidoId.data, sesion.clienteId) : null;

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
      {/* HU-E2: acá se integra el botón de pago de Mercado Pago (`checkout_url`). */}
      <p className="text-sm text-slate-600">El pago online estará disponible próximamente.</p>
    </div>
  );
}
