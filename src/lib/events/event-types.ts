/**
 * HU-7 — Sección 7: payloads de los eventos de dominio emitidos por
 * `lib/services/inventario/stock.service.ts`. El Módulo D (audit-log.listener.ts)
 * consume estos eventos para construir el `AuditLog` encadenado por SHA-256.
 */

export interface UmbralesConfiguradosPayload {
  stock_deposito_id: string;
  variante_sku_id: string;
  deposito_id: string;
  usuario_id: string;
  punto_pedido: number;
  stock_seguridad: number;
}

export interface UmbralCriticoAlcanzadoPayload {
  stock_deposito_id: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad_resultante: number;
  punto_pedido: number;
  movimiento_id_origen: string;
}

/**
 * HU-A3 — Payload emitido tras la creación atómica del LegajoPrueba.
 * Escucha: futuro audit-log.listener.ts y módulo de notificaciones.
 *
 * Nota: `efectivo_placa` y `efectivo_organismo` NO se incluyen en el payload
 * del evento para evitar que datos cifrados circulen por el bus en memoria.
 * Los listeners que necesiten los datos identificatorios deben leerlos de la
 * BD y descifrarlos bajo demanda.
 */
export interface LegajoPruebaIniciadoPayload {
  legajo_prueba_id: string;
  variante_sku_id: string;
  deposito_origen_id: string;
  movimiento_stock_id: string;
  cantidad: number;
  usuario_id: string;
  ip: string;
}

/** Mapa evento → payload, usado por `domain-event-bus.ts` para tipar `emit`/`on`. */
export interface DomainEventMap {
  "stock:umbrales_configurados": UmbralesConfiguradosPayload;
  "stock:umbral_critico_alcanzado": UmbralCriticoAlcanzadoPayload;
  /** HU-A3: se emite tras la transacción atómica de asignación en prueba. */
  "inventario:legajo_prueba_iniciado": LegajoPruebaIniciadoPayload;
}

export type DomainEventName = keyof DomainEventMap;

