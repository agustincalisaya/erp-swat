/**
 * Contrato de dominio del Conector de Mercado Pago (spec_modulo_F.md §3.1,
 * RULES.md §4 — patrón Adapter): Módulo E solo conoce estos tipos, nunca la
 * forma de la API de Mercado Pago. Sin datos de tarjeta en ningún tipo (CA1).
 *
 * // PROVISORIO HU-E2 — completar en HU-F1 (owner: Rama)
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
  notification_url: string;
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
