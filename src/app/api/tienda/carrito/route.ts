/**
 * @module route — GET /api/tienda/carrito
 * @description HU-E1 (spec_modulo_E.md §2.1) — carrito activo del visitante
 * (cookie firmada) o de la cuenta (sesión de Cliente Web). No exige sesión (CA6).
 */
import { obtenerCarrito } from "@/lib/services/ecommerce/carrito.service";
import { resolverContextoTienda } from "@/lib/services/ecommerce/contexto-tienda";
import { respuestaError, respuestaOk } from "@/lib/services/ecommerce/respuesta-tienda";

export async function GET() {
  try {
    const { carrito } = await resolverContextoTienda();
    return respuestaOk(await obtenerCarrito(carrito));
  } catch (err) {
    return respuestaError(err, "GET /api/tienda/carrito");
  }
}
