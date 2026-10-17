/** Presentación de la reserva ya resuelta por el servidor. */
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { DesgloseCupon } from "@/components/tienda/DesgloseCupon";
import { formatearPrecio } from "@/components/tienda/formato";
import type { PedidoWebPendienteVista } from "@/lib/services/ecommerce/checkout.service";
import { AlertTriangle, Clock3, CreditCard, ShoppingBag } from "lucide-react";
import styles from "@/components/tienda/compra.module.css";

const volverAlCatalogo = (
  <Link href="/tienda/catalogo" className={`${buttonVariants({ variant: "outline" })} ${styles.secondaryAction}`}>
    Volver al catálogo
  </Link>
);

export function CheckoutPendienteVista({ pedido, vencimiento, checkoutUrl }: {
  pedido: PedidoWebPendienteVista | null;
  vencimiento: string | null;
  checkoutUrl: string | null;
}) {
  if (!pedido) {
    return (
      <div className={styles.stateShell}><section className={styles.stateCard}>
        <span className={styles.stateIcon}><ShoppingBag aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Checkout</p>
        <h1 className={styles.stateTitle}>No encontramos esa compra pendiente</h1>
        <p className={styles.stateText}>Agregá productos al carrito para iniciar una compra.</p>
        <div className={styles.stateActions}>{volverAlCatalogo}</div>
      </section></div>
    );
  }

  if (pedido.estado_visible === "RESERVA_VENCIDA") {
    return (
      <div className={styles.stateShell}><section className={styles.stateCard}>
        <span className={`${styles.stateIcon} ${styles.stateIconWarning}`}><AlertTriangle aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Estado del pedido</p>
        <h1 className={styles.stateTitle}>Reserva vencida</h1>
        <p className={styles.orderNumber}>Pedido {pedido.numero_venta}</p>
        <p className={styles.stateText}>
            El pago no se confirmó antes de las {vencimiento}: la reserva venció y los artículos volvieron a estar
            disponibles. Podés armar el carrito de nuevo e iniciar otra compra.
        </p>
        <div className={styles.stateActions}>{volverAlCatalogo}</div>
      </section></div>
    );
  }

  return (
    <div className={styles.stateShell}><section className={styles.stateCard}>
      <span className={styles.stateIcon}><Clock3 aria-hidden="true" /></span>
      <p className={styles.eyebrow}>Checkout · Pago pendiente</p>
      <h1 className={styles.stateTitle}>Reservamos tu compra</h1>
      <p className={styles.orderNumber}>Pedido {pedido.numero_venta}</p>
      <p className={styles.stateText}>Los artículos quedan reservados hasta las <strong>{vencimiento}</strong>.
        Si el pago no se confirma antes, la reserva vence y el stock vuelve a estar disponible.</p>
      <div className={styles.orderTotal}><span>Total del pedido</span><strong>{formatearPrecio(pedido.total)}</strong></div>
      {pedido.cupon && <DesgloseCupon cupon={pedido.cupon} total={pedido.total} />}
      {checkoutUrl ? (
        <div className={styles.stateActions}>
          {/* Checkout Pro: la tarjeta se carga en Mercado Pago, nunca en SWAT (CA1). */}
          <a href={checkoutUrl} className={`${buttonVariants()} ${styles.paymentAction}`}>
            <CreditCard size={18} aria-hidden="true" /> Pagar con Mercado Pago
          </a>
          <p className={styles.stateNote}>
            Vas a pagar en el sitio de Mercado Pago. Tus datos de tarjeta nunca pasan por SWAT Indumentarias.
          </p>
        </div>
      ) : (
        <Alert variant="destructive" role="alert" className={styles.stateAlert}>
          <AlertTitle>No pudimos conectar con Mercado Pago</AlertTitle>
          <AlertDescription>
            Tu reserva sigue vigente. <Link href={`/tienda/checkout/pendiente?pedido=${pedido.pedido_venta_id}`}>Reintentá</Link>{" "}
            en unos segundos.
          </AlertDescription>
        </Alert>
      )}
    </section></div>
  );
}
