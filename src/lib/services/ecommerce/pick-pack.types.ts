import type { MedioPagoVenta } from "@prisma/client";
import type { EcommercePedidoAdmitidoColaPayload } from "@/lib/events/event-types";

/**
 * DTOs de entrada/salida de HU-E12 — Pick & Pack / Click & Collect.
 *
 * Estos tipos son proyecciones deliberadamente mínimas: no exponen modelos
 * Prisma completos ni datos sensibles (QR, pagos, PII fiscal, etc.).
 * Única excepción: `ColaPreparacionItemConPagoDto` (HU-E14, spec E §6.3
 * E14-3), que solo se construye para quien tiene
 * `ecommerce:leer_historial_ordenes`.
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

/**
 * Ítem de la cola de preparación (GET /api/ecommerce/preparacion) —
 * proyección base, sin datos de pago ni fiscales (spec E §6.3 E14-2).
 */
export interface ColaPreparacionItemDto {
  pedido_venta_id: string;
  pedido_venta_ecommerce_id: string;
  numero_venta: string;
  /**
   * HU-E14: solo `Cliente.nombre` (nunca DNI, email ni teléfono). `null` si
   * el pedido no tiene cliente o el cliente está dado de baja (incluye
   * fusionados: no se sigue `fusionado_en_id`).
   */
  cliente_nombre: string | null;
  fecha_pago_confirmado: Date | null;
  prioridad_manual: number | null;
  estado_ecommerce: string;
  operador_asignado_id: string | null;
  /** HU-E14: suma de cantidades de los ítems vigentes (E14-1). */
  unidades_totales: number;
  lineas: LineaPreparacionDto[];
  progreso: ProgresoPreparacionDto;
}

/**
 * HU-E14 — datos de pago ya registrados de la venta (E14-3). `total` es
 * `PedidoVenta.total` congelado como string de 2 decimales (convención de
 * lecturas administrativas, §2.13.15). Sin `referencia` (payment_id) ni importe.
 */
export interface DatosPagoColaPreparacionDto {
  total: string;
  medios: MedioPagoVenta[];
}

/** Ítem de la cola con datos de pago — solo con `ecommerce:leer_historial_ordenes`. */
export interface ColaPreparacionItemConPagoDto extends ColaPreparacionItemDto {
  pago: DatosPagoColaPreparacionDto;
}

/** Opciones de `listarColaPreparacion`; default seguro: sin datos de pago. */
export interface OpcionesColaPreparacion {
  incluirDatosPago?: boolean;
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

/** Paginación de la cola con datos de pago (HU-E14). */
export interface PaginacionColaPreparacionConPagoDto extends Omit<PaginacionColaPreparacionDto, "items"> {
  items: ColaPreparacionItemConPagoDto[];
}
