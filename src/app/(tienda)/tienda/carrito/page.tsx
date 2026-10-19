/**
 * @page CarritoTienda
 * @route /tienda/carrito
 * @description HU-E1 (CA4/CA6/CA7) — carrito del visitante o de la cuenta. Sin
 * sesión se puede armar; para iniciar la compra hay que ingresar (CA6).
 */
import Link from "next/link";
import { CarritoCliente } from "@/components/tienda/CarritoCliente";
import { obtenerCarrito } from "@/lib/services/ecommerce/carrito.service";
import { resolverContextoTienda } from "@/lib/services/ecommerce/contexto-tienda";
import styles from "@/components/tienda/compra.module.css";

export default async function CarritoTiendaPage() {
  const contexto = await resolverContextoTienda();
  const carrito = await obtenerCarrito(contexto.carrito);

  return (
    <div className={styles.shell}>
      <nav aria-label="Ruta de navegación" className={styles.breadcrumbs}>
        <Link href="/tienda">Inicio</Link><span aria-hidden="true">/</span><span aria-current="page">Carrito</span>
      </nav>
      <p className={styles.eyebrow}>Tu selección</p>
      <h1 className={styles.heading}>Tu carrito</h1>
      <p className={styles.intro}>Revisá tus artículos, variantes e importes antes de iniciar la compra.</p>
      {contexto.sesion?.vinculacionPendiente && (
        <p className={styles.accountNotice}>
          Tu cuenta está pendiente de validación de identidad en sucursal. <Link className="underline" href="/tienda/cuenta">Ver estado de la cuenta</Link>
        </p>
      )}
      <CarritoCliente carrito={carrito} conSesion={contexto.sesion !== null && !contexto.sesion.vinculacionPendiente} compraBloqueada={contexto.sesion?.vinculacionPendiente === true} />
    </div>
  );
}
