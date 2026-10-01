/**
 * @page CarritoTienda
 * @route /tienda/carrito
 * @description HU-E1 (CA4/CA6/CA7) — carrito del visitante o de la cuenta. Sin
 * sesión se puede armar; para iniciar la compra hay que ingresar (CA6).
 */
import { CarritoCliente } from "@/components/tienda/CarritoCliente";
import { obtenerCarrito } from "@/lib/services/ecommerce/carrito.service";
import { resolverContextoTienda } from "@/lib/services/ecommerce/contexto-tienda";

export default async function CarritoTiendaPage() {
  const contexto = await resolverContextoTienda();
  const carrito = await obtenerCarrito(contexto.carrito);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tu carrito</h1>
      <CarritoCliente carrito={carrito} conSesion={contexto.sesion !== null} />
    </div>
  );
}
