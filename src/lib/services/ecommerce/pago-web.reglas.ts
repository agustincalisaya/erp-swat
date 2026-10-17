/**
 * HU-E2 — Reglas puras del pago web (sin Prisma: se testean con node --test).
 */

/** Moneda única del canal web (spec E §2.2: la tienda cobra en pesos). */
export const MONEDA_CANAL_WEB = "ARS";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `external_reference` válido = UUID de `PedidoVentaEcommerce` (HU-E1 §14.1). */
export function esReferenciaValida(externalReference: string | null | undefined): externalReference is string {
  return typeof externalReference === "string" && UUID.test(externalReference);
}

/** Pasa un monto a centavos enteros, para comparar sin errores de coma flotante. */
export function aCentavos(monto: number | string): number {
  return Math.round(Number(monto) * 100);
}

/**
 * P13 — El pago solo se aplica si MP cobró EXACTAMENTE el total congelado en
 * base (centavo a centavo) y en la moneda del canal. Nunca se usa un monto del
 * navegador ni del body del webhook: `montoMp` sale de `consultarPago()`.
 */
export function pagoCoincideConPedido(
  totalPedido: number | string,
  montoMp: number,
  monedaMp: string,
): boolean {
  return monedaMp === MONEDA_CANAL_WEB && aCentavos(totalPedido) === aCentavos(montoMp);
}

/**
 * Q2 — Un pago aprobado solo se confirma si TODAS las reservas del pedido
 * siguen abiertas y sin vencer. Una reserva vencida, aunque el job todavía no
 * la haya liberado, hace del pago un "pago tardío" (reembolso manual).
 */
export function reservasVigentesParaConfirmar(
  reservas: readonly ({ fecha_expiracion: Date; fecha_fin_reserva: Date | null } | null)[],
  ahora: Date,
): boolean {
  return (
    reservas.length > 0 &&
    reservas.every((r) => r !== null && r.fecha_fin_reserva === null && r.fecha_expiracion.getTime() > ahora.getTime())
  );
}

export type ResultadoNotificacion = "CONFIRMADO" | "RECHAZADO" | "PENDIENTE" | "SIN_EFECTO" | "ANOMALIA";

/**
 * Qué hacer con un pago APROBADO que llegó a un pedido que ya no está
 * PAGO_PENDIENTE (la transición condicionada no aplicó):
 *  - mismo `payment_id` ya imputado → reintento de MP, sin efectos;
 *  - pedido rechazado o anulado → pago tardío (Q2);
 *  - cualquier otro estado con otro pago → pago duplicado (D-E2-5).
 */
export function clasificarAprobadoSobreResuelto(
  estadoEcommerce: string,
  paymentIdGuardado: string | null,
  paymentIdNuevo: string,
): "SIN_EFECTO" | "PAGO_TARDIO" | "PAGO_DUPLICADO" {
  if (paymentIdGuardado === paymentIdNuevo && estadoEcommerce !== "PAGO_RECHAZADO") return "SIN_EFECTO";
  if (estadoEcommerce === "PAGO_RECHAZADO" || estadoEcommerce === "ANULADO") return "PAGO_TARDIO";
  return "PAGO_DUPLICADO";
}
