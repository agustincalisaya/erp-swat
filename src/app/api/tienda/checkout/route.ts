/**
 * @module route — POST /api/tienda/checkout
 * @description HU-E1 (D1: checkout parcial; spec_modulo_E.md §2.2 pasos 1/3/4)
 * — valida el carrito de la cuenta, reserva stock con TTL y crea el pedido en
 * Pago Pendiente. Exige sesión de Cliente Web (`withSesionClienteWeb`, CA6):
 * sin sesión → 401 SESION_CLIENTE_WEB_REQUERIDA. NO es `withPermission` (el
 * Cliente Web no es un rol del RBAC interno).
 *
 * 201 = pedido nuevo · 200 = pedido Pago Pendiente vigente devuelto sin
 * reservar de nuevo (D10, idempotente por cuenta).
 */
import { withSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { iniciarCheckout } from "@/lib/services/ecommerce/checkout.service";
import { respuestaError, respuestaOk } from "@/lib/services/ecommerce/respuesta-tienda";

export const POST = withSesionClienteWeb(async (_req, sesion) => {
  try {
    const checkout = await iniciarCheckout(sesion);
    return respuestaOk(checkout, checkout.reutilizado ? 200 : 201);
  } catch (err) {
    return respuestaError(err, "POST /api/tienda/checkout");
  }
});
