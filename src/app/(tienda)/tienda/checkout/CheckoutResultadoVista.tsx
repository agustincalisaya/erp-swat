/** Presentación de los estados de pago ya resueltos por el servidor. */
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DesgloseCupon } from "@/components/tienda/DesgloseCupon";
import { formatearPrecio } from "@/components/tienda/formato";
import type { ResultadoPagoVista } from "@/lib/services/ecommerce/pago-web.service";
import { AlertTriangle, Clock3, PackageCheck, ShoppingBag } from "lucide-react";
import styles from "@/components/tienda/compra.module.css";

export function CheckoutResultadoVista({ pedido }: { pedido: ResultadoPagoVista | null }) {
  if (!pedido) {
    return (
      <div className={styles.stateShell}><section className={styles.stateCard}>
        <span className={styles.stateIcon}><ShoppingBag aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Estado del pedido</p>
        <h1 className={styles.stateTitle}>No encontramos esa compra</h1>
        <Link href="/tienda/catalogo" className={`${buttonVariants({ variant: "outline" })} ${styles.secondaryAction}`}>
          Volver al catálogo
        </Link>
      </section></div>
    );
  }

  if (pedido.estado_ecommerce === "PAGO_RECHAZADO") {
    return (
      <div className={styles.stateShell}><section className={styles.stateCard}>
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}><AlertTriangle aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Estado del pedido</p>
        <h1 className={styles.stateTitle}>El pago fue rechazado</h1>
        <p className={styles.orderNumber}>Pedido {pedido.numero_venta}</p>
        <p className={styles.stateText}>
            Mercado Pago no aprobó el pago. Liberamos la reserva y volvimos a poner los artículos en tu carrito: podés
            reintentar la compra con otro medio de pago.
        </p>
        <Link href="/tienda/carrito" className={`${buttonVariants()} ${styles.secondaryAction}`}>
          Ir al carrito y reintentar
        </Link>
      </section></div>
    );
  }

  if (pedido.estado_ecommerce === "PAGO_PENDIENTE") {
    return (
      <div className={styles.stateShell}><section className={styles.stateCard}>
        <span className={styles.stateIcon}><Clock3 aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Estado del pedido</p>
        <h1 className={styles.stateTitle}>Estamos esperando la confirmación del pago</h1>
        <p className={styles.orderNumber}>Pedido {pedido.numero_venta}</p>
        <p className={styles.stateText}>
            Todavía no recibimos la confirmación de Mercado Pago. Puede demorar unos segundos.
        </p>
        <Link href={`/tienda/checkout/resultado?pedido=${pedido.pedido_venta_id}`} className={`${buttonVariants({ variant: "outline" })} ${styles.secondaryAction}`}>
          Actualizar
        </Link>
      </section></div>
    );
  }

  return (
    <div className={styles.stateShell}><section className={styles.stateCard}>
      <span className={styles.stateIcon}><PackageCheck aria-hidden="true" /></span>
      <p className={styles.eyebrow}>Estado del pedido</p>
      <h1 className={styles.stateTitle}>¡Pago confirmado!</h1>
      <p className={styles.orderNumber}>Pedido {pedido.numero_venta}</p>
      <p className={styles.stateText}>
          {pedido.comprobante &&
            ` Emitimos tu ${pedido.comprobante.tipo === "FACTURA_B" ? "Factura B" : pedido.comprobante.tipo} (CAE ${pedido.comprobante.cae_simulado}).`}{" "}
          Te avisamos cuando esté listo para retirar en Sucursal Salta.
      </p>
      <div className={styles.orderTotal}><span>Total del pedido</span><strong>{formatearPrecio(pedido.total)}</strong></div>
      {pedido.cupon && <DesgloseCupon cupon={pedido.cupon} total={pedido.total} />}
      <Link href="/tienda/catalogo" className={`${buttonVariants({ variant: "outline" })} ${styles.secondaryAction}`}>
        Seguir comprando
      </Link>
    </section></div>
  );
}
