"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import styles from "@/components/tienda/compra.module.css";

/** Estado seguro cuando falla la lectura del pedido o del servicio de pago. */
export default function CheckoutError() {
  return (
    <div className={styles.stateShell}>
      <section className={styles.stateCard} role="alert">
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}><AlertTriangle aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Estado del pedido</p>
        <h1 className={styles.stateTitle}>No pudimos mostrar tu compra</h1>
        <p className={styles.stateText}>La información no está disponible ahora. Revisá tus pedidos antes de iniciar otra compra.</p>
        <div className={styles.stateActions}>
          <Link href="/tienda/cuenta/pedidos" className={`${buttonVariants({ variant: "outline" })} ${styles.secondaryAction}`}>
            Ver mis pedidos
          </Link>
        </div>
      </section>
    </div>
  );
}
