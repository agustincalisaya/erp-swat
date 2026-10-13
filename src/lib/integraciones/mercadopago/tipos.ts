/**
 * Contrato de dominio del Conector de Mercado Pago (spec_modulo_F.md §3.1,
 * RULES.md §4 — patrón Adapter): Módulo E solo conoce estos tipos, nunca la
 * forma de la API de Mercado Pago. Sin datos de tarjeta en ningún tipo (CA1).
 *
 * HU-F1 agregó el tipo del reembolso (`ReembolsoSolicitado`,
 * `EstadoReembolsoDominio`) que consume HU-E13.
 */

export type MonedaCobro = "ARS";

export interface IniciarCobroInput {
  /** `PedidoVentaEcommerce.id` — único vínculo pago ↔ pedido (HU-E1 §14.1). */
  external_reference: string;
  /** Texto de la única línea de la preferencia (ej. "Pedido V-2026-000040"). */
  titulo: string;
  /** Total ya calculado en el servidor (precio congelado HU-B9 + cupón). */
  monto: number;
  moneda: MonedaCobro;
  /** Vencimiento de la preferencia = vencimiento de la reserva del checkout. */
  expiracion: Date;
  back_urls: { success: string; failure: string; pending: string };
}

export interface CobroIniciado {
  preference_id: string;
  /** `init_point` de Checkout Pro (redirect). */
  checkout_url: string;
}

export type EstadoPagoDominio = "APROBADO" | "RECHAZADO" | "PENDIENTE";

export interface PagoConsultado {
  payment_id: string;
  estado: EstadoPagoDominio;
  /** `status` crudo de MP (ej. "approved", "rejected", "in_process"). */
  status_mp: string;
  /** `status_detail` de MP (ej. "accredited", "cc_rejected_insufficient_amount"). */
  status_detail: string;
  monto: number;
  moneda: string;
  /** null si el pago no trae referencia (pago huérfano). */
  external_reference: string | null;
  /** `date_approved` (null si no fue aprobado). */
  fecha_aprobacion: string | null;
}

/** Estado de dominio de un reembolso (task HU-F1 R1). */
export type EstadoReembolsoDominio = "APROBADO" | "RECHAZADO" | "PENDIENTE";

/**
 * Resultado de solicitar un reembolso (total o parcial) a Mercado Pago
 * (task HU-F1 R1). Contrato de consumo de HU-E13 — sin datos de tarjeta.
 */
export interface ReembolsoSolicitado {
  /** `id` del refund en Mercado Pago. */
  refund_id: string;
  /** `payment_id` reembolsado. */
  payment_id: string;
  /** Monto efectivamente reembolsado (total del pago si no se pidió parcial). */
  monto: number;
  /** Estado de dominio derivado del `status` de MP. */
  estado: EstadoReembolsoDominio;
}
