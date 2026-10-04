/**
 * @page CheckoutResultadoTienda
 * @route /tienda/checkout/resultado?pedido=<pedido_venta_id>
 * @description HU-E2 — página de retorno de Mercado Pago (`back_urls` de
 * Checkout Pro). El estado se lee SIEMPRE de la base: los parámetros que
 * agrega Mercado Pago a la URL (`status`, `payment_id`, …) se ignoran, porque
 * los puede escribir cualquiera. La confirmación real la hace el webhook (CA2).
 * Solo se muestra si el pedido es del cliente de la sesión (spec E §2.9).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { DesgloseCupon } from "@/components/tienda/DesgloseCupon";
import { formatearPrecio } from "@/components/tienda/formato";
import { getSesionClienteWeb, getSesionClienteWebVinculada } from "@/lib/auth/sesion-cliente-web";
import { obtenerResultadoPago } from "@/lib/services/ecommerce/pago-web.service";

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
  if (!pedido) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Alert>
          <AlertTitle>No encontramos esa compra</AlertTitle>
        </Alert>
        <Link href="/tienda/catalogo" className={buttonVariants({ variant: "outline" })}>
          Volver al catálogo
        </Link>
      </div>
    );
  }

  if (pedido.estado_ecommerce === "PAGO_RECHAZADO") {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">El pago fue rechazado</h1>
        <Alert variant="destructive">
          <AlertTitle>Pedido {pedido.numero_venta} — Pago rechazado</AlertTitle>
          <AlertDescription>
            Mercado Pago no aprobó el pago. Liberamos la reserva y volvimos a poner los artículos en tu carrito: podés
            reintentar la compra con otro medio de pago.
          </AlertDescription>
        </Alert>
        <Link href="/tienda/carrito" className={buttonVariants()}>
          Ir al carrito y reintentar
        </Link>
      </div>
    );
  }

  if (pedido.estado_ecommerce === "PAGO_PENDIENTE") {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">Estamos esperando la confirmación del pago</h1>
        <Alert>
          <AlertTitle>Pedido {pedido.numero_venta} — Pago pendiente</AlertTitle>
          <AlertDescription>
            Todavía no recibimos la confirmación de Mercado Pago. Puede demorar unos segundos.
          </AlertDescription>
        </Alert>
        <Link href={`/tienda/checkout/resultado?pedido=${pedido.pedido_venta_id}`} className={buttonVariants({ variant: "outline" })}>
          Actualizar
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">¡Pago confirmado!</h1>
      <Alert>
        <AlertTitle>Pedido {pedido.numero_venta} — Pago confirmado</AlertTitle>
        <AlertDescription>
          Total {formatearPrecio(pedido.total)}.
          {pedido.comprobante &&
            ` Emitimos tu ${pedido.comprobante.tipo === "FACTURA_B" ? "Factura B" : pedido.comprobante.tipo} (CAE ${pedido.comprobante.cae_simulado}).`}{" "}
          Te avisamos cuando esté listo para retirar en Sucursal Salta.
        </AlertDescription>
      </Alert>
      {pedido.cupon && <DesgloseCupon cupon={pedido.cupon} total={pedido.total} />}
      <Link href="/tienda/catalogo" className={buttonVariants({ variant: "outline" })}>
        Seguir comprando
      </Link>
    </div>
  );
}
