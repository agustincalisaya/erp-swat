/**
 * @module route — POST /api/tienda/checkout
 * @description HU-E1 (D1: checkout parcial; spec_modulo_E.md §2.2 pasos 1/3/4)
 * — valida el carrito de la cuenta, reserva stock con TTL y crea el pedido en
 * Pago Pendiente. Exige sesión de Cliente Web (`withSesionClienteWeb`, CA6):
 * sin sesión → 401 SESION_CLIENTE_WEB_REQUERIDA. NO es `withPermission` (el
 * Cliente Web no es un rol del RBAC interno).
 *
 * HU-E2: body opcional `{ cupon_codigo? }` (`IniciarCheckoutSchema`, vacío =
 * sin cupón) y respuesta con `checkout_url` de Checkout Pro. El importe se
 * calcula en el servidor: cualquier otro campo del body → 400 (CA5).
 *
 * 201 = pedido nuevo · 200 = pedido Pago Pendiente vigente devuelto sin
 * reservar de nuevo (D10, idempotente por cuenta).
 */
import { withSesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import { IniciarCheckoutSchema } from "@/lib/schemas/ecommerce.schema";
import { iniciarCheckout } from "@/lib/services/ecommerce/checkout.service";
import { respuestaError, respuestaOk, respuestaValidacion } from "@/lib/services/ecommerce/respuesta-tienda";

export const POST = withSesionClienteWeb(async (req, sesion) => {
  const texto = await req.text();
  let cuerpo: unknown = {};
  if (texto.trim()) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = null;
    }
  }
  const input = IniciarCheckoutSchema.safeParse(cuerpo);
  if (!input.success) return respuestaValidacion(input.error);

  try {
    const checkout = await iniciarCheckout(sesion, input.data);
    return respuestaOk(checkout, checkout.reutilizado ? 200 : 201);
  } catch (err) {
    return respuestaError(err, "POST /api/tienda/checkout");
  }
}, { mensajeSinSesion: "Debe iniciar sesión para completar la compra" });
