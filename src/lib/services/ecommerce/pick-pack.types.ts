import type { EcommercePedidoAdmitidoColaPayload } from "@/lib/events/event-types";

/**
 * DTOs de entrada/salida de HU-E12 — Pick & Pack / Click & Collect.
 *
 * Estos tipos son proyecciones deliberadamente mínimas: no exponen modelos
 * Prisma completos ni datos sensibles (QR, pagos, PII fiscal, etc.).
 */

/** Representación de una variante en la línea de preparación. */
export interface VariantePreparacionDto {
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  talle?: string | null;
  color?: string | null;
  modelo?: string | null;
}

/** Línea de un pedido en la cola/detalle. */
export interface LineaPreparacionDto {
  pedido_venta_item_id: string;
  variante: VariantePreparacionDto;
  cantidad_requerida: number;
  cantidad_confirmada: number;
  completa: boolean;
}

/** Progreso global del pedido. */
export interface ProgresoPreparacionDto {
  total_requerido: number;
  total_confirmado: number;
  porcentaje: number;
  completo: boolean;
}

/** Ítem de la cola de preparación (GET /api/ecommerce/pick-pack/cola). */
export interface ColaPreparacionItemDto {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  fecha_pago_confirmado: Date | null;
  prioridad_manual: number | null;
  estado_ecommerce: string;
  operador_asignado_id: string | null;
  lineas: LineaPreparacionDto[];
  progreso: ProgresoPreparacionDto;
}

/** Detalle completo de un pedido en Pick & Pack (GET /.../pick-pack/[id]). */
export interface DetallePreparacionDto {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  fecha_pago_confirmado: Date | null;
  prioridad_manual: number | null;
  estado_ecommerce: string;
  operador_asignado_id: string | null;
  /** Datos mínimos del operador solo si el pedido está asignado. */
  operador?: { id: string; nombre_completo: string } | null;
  lineas: LineaPreparacionDto[];
  progreso: ProgresoPreparacionDto;
}

/** Resultado de tomar un pedido. */
export interface ResultadoTomarPedido {
  pedido_venta_id: string;
  operador_asignado_id: string;
  cambio_realizado: boolean;
}

/** Resultado de admitir un pedido pagado a la cola de preparación. */
export interface AdmisionResultado {
  pedido_venta_id: string;
  transicion_realizada: boolean;
  /** Metadata del evento a publicar post-COMMIT por el caller E2. */
  evento_pendiente?: {
    tipo: "ecommerce:pedido_admitido_cola";
    payload: EcommercePedidoAdmitidoColaPayload;
  };
}

/** Resultado de cambiar la prioridad. */
export interface PrioridadResultado {
  pedido_venta_id: string;
  prioridad_manual: number | null;
  prioridad_anterior: number | null;
  cambio_realizado: boolean;
}

/** Resultado de confirmar un ítem por escaneo. */
export interface ResultadoConfirmarItem {
  pedido_venta_item_id: string;
  variante_sku_id: string;
  scan_id: string;
  cantidad_confirmada: number;
  progreso: ProgresoPreparacionDto;
  idempotente: boolean;
  cambio_realizado: boolean;
}

/** Resultado de completar la preparación. */
export interface ResultadoCompletarPreparacion {
  pedido_venta_id: string;
  estado_ecommerce: string;
  transicion_realizada: boolean;
  cambio_realizado: boolean;
  idempotente: boolean;
  plazo_retiro_vencimiento: Date | null;
  progreso: ProgresoPreparacionDto;
}

/** Resultado de cambiar la prioridad. */
export interface ResultadoPrioridad {
  pedido_venta_id: string;
  prioridad_manual: number | null;
  prioridad_anterior: number | null;
  cambio_realizado: boolean;
}

/** Paginación de la cola. */
export interface PaginacionColaPreparacionDto {
  items: ColaPreparacionItemDto[];
  total: number;
  page: number;
  page_size: number;
}
