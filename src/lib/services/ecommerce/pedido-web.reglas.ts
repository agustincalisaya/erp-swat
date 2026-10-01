/**
 * HU-E1 — Estado VISIBLE de un pedido web Pago Pendiente en la tienda.
 *
 * Solo lectura: NO cambia `PedidoVentaEcommerce.estado_ecommerce` (la
 * transición a ANULADO por TTL vencido es de HU-E7, spec_modulo_E.md §2.7 —
 * coordinación pendiente, ver docs/tasks/HU-E1.md). Mientras E7 no exista, un
 * pedido PAGO_PENDIENTE cuya reserva ya venció no puede mostrarse como
 * "pendiente de pago": se muestra "Reserva vencida", derivado de
 * `ttl_expiracion` (el vencimiento más próximo de sus reservas).
 * Función pura (sin Prisma) para testearla con node --test.
 */

export type EstadoVisiblePedidoWeb = "PAGO_PENDIENTE" | "RESERVA_VENCIDA";

export function derivarEstadoVisiblePedidoWeb(
  ttlExpiracion: Date,
  ahora: Date = new Date(),
): EstadoVisiblePedidoWeb {
  return ttlExpiracion.getTime() <= ahora.getTime() ? "RESERVA_VENCIDA" : "PAGO_PENDIENTE";
}
