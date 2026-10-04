/**
 * HU-E7 — Reglas puras de la anulación de una orden web no abonada
 * (spec_modulo_E.md §2.7; task_relos.md D4, D13). Sin base de datos ni
 * `server-only`: se prueban con `npm test`.
 */

/** Estados de `EstadoEcommerce` (espejo literal de `schema.prisma`). */
export const ESTADOS_ECOMMERCE = [
  "PAGO_PENDIENTE",
  "PAGO_CONFIRMADO",
  "PAGO_RECHAZADO",
  "EN_PREPARACION",
  "LISTO_PARA_RETIRO",
  "ENTREGADO",
  "ANULADO",
  "CANCELADO",
  "VENCIDO_SIN_RETIRO",
] as const;
export type EstadoEcommerceAnulacion = (typeof ESTADOS_ECOMMERCE)[number];

/** Camino de anulación según el estado de partida (D5 / D6). */
export type CaminoAnulacion = "PAGO_PENDIENTE" | "PAGO_RECHAZADO";

export type Anulabilidad = { anulable: true; camino: CaminoAnulacion } | { anulable: false };

/** `deletion_reason` de la vía automática (D13): distinguible por el Módulo D. */
export const MOTIVO_ANULACION_TTL = "Reserva vencida sin pago (TTL)";

/** Mensaje del `409 TRANSICION_INVALIDA` (texto literal de la spec §2.7). */
export const MENSAJE_TRANSICION_INVALIDA_ANULACION =
  "Solo una orden no abonada (Pago Pendiente o Pago Rechazado) puede anularse por esta vía";

/** D4: solo `PAGO_PENDIENTE` y `PAGO_RECHAZADO` se anulan por esta vía. */
export function evaluarAnulabilidad(estadoEcommerce: string): Anulabilidad {
  if (estadoEcommerce === "PAGO_PENDIENTE") return { anulable: true, camino: "PAGO_PENDIENTE" };
  if (estadoEcommerce === "PAGO_RECHAZADO") return { anulable: true, camino: "PAGO_RECHAZADO" };
  return { anulable: false };
}
