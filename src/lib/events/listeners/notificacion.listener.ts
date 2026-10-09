/**
 * HU-F3 — Listener del Motor de Notificaciones (spec_modulo_F.md §2.3/§3.3).
 *
 * ÚNICA vía de generación de `Notificacion`: ningún módulo llama
 * `prisma.notificacion.create()`; emiten su evento y esta tabla de suscripción
 * DECLARATIVA decide destinatarios, prioridad default y `clave_origen`.
 *
 * Fire-and-forget post-COMMIT (spec F §2.3), igual que `audit-log.listener.ts`:
 * el handler no se `await`-ea hacia el emisor y no propaga NINGÚN error — ni
 * síncrono (el `EventEmitter` despacha en el mismo stack que `emit()`, así que
 * un `throw` acá rompería la operación de origen) ni asíncrono. Registrado por
 * import dinámico desde `domain-event-bus.ts`.
 *
 * `clave_origen` identifica la OCURRENCIA del evento, no el registro (task §8,
 * Punto abierto 5 — decidido): así una segunda alerta legítima sobre la misma
 * fila vuelve a notificarse, y un mismo evento reprocesado no duplica.
 *
 * Filas NO activas de spec F §3.3 (task HU-F3 §5):
 *  - BLOQUEADO (sin evento en `event-types.ts`, Punto abierto 3): diferencia de
 *    arqueo (B2/G1 → Rol TESORERO_CENTRAL), ruptura de cadena de hashes
 *    (D.3/D.4 → Rol AUDITOR; `verificar-cadena` no emite evento) y OC
 *    pendiente de aprobación (H → Rol SUPERVISOR_COMPRAS; no existe el estado).
 *  - Pendientes de su dueño (agregan su fila al declarar el evento):
 *    `ecommerce:plazo_retiro_por_vencer` y
 *    `ecommerce:pedido_vencido_sin_retiro` (E13).
 */
import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { DomainEventMap } from "@/lib/events/event-types";
import {
  generarNotificaciones,
  type GenerarNotificacionesInput,
} from "@/lib/services/notificaciones/notificacion.service";

type Generacion = Omit<GenerarNotificacionesInput, "tipo_evento" | "prioridad_default">;

interface Suscripcion<K extends keyof DomainEventMap> {
  evento: K;
  prioridad_default: GenerarNotificacionesInput["prioridad_default"];
  /** `null` = el evento no tiene a quién notificar. */
  armar: (payload: DomainEventMap[K]) => Generacion | null;
}

/** Borra el genérico para poder listar suscripciones de eventos distintos. */
function suscripcion<K extends keyof DomainEventMap>(s: Suscripcion<K>): Suscripcion<keyof DomainEventMap> {
  return s as unknown as Suscripcion<keyof DomainEventMap>;
}

export const SUSCRIPCIONES_NOTIFICACION = [
  // Módulo A (HU-A7) → Rol Encargado de Depósito.
  suscripcion({
    evento: "stock:umbral_critico_alcanzado",
    prioridad_default: "ADVERTENCIA",
    armar: (p) => ({
      // Un movimiento multi-ítem emite una alerta por fila de stock.
      clave_origen: `${p.movimiento_id_origen}:${p.stock_deposito_id}`,
      variables: { cantidad_resultante: p.cantidad_resultante, punto_pedido: p.punto_pedido },
      destinatarios: { roles: ["ENCARGADO_DEPOSITO"] },
    }),
  }),
  // Módulo D (D.2) → usuario afectado + Rol Administrador.
  suscripcion({
    evento: "usuario:suspendido_automaticamente",
    prioridad_default: "CRITICA",
    armar: (p) => {
      const bloqueadoHasta = new Date(p.bloqueado_hasta).toISOString();
      return {
        clave_origen: `${p.usuario_id}:${bloqueadoHasta}`,
        variables: { intentos_fallidos: p.intentos_fallidos, bloqueado_hasta: bloqueadoHasta },
        destinatarios: { usuario_ids: [p.usuario_id], roles: ["ADMINISTRADOR"] },
      };
    },
  }),
  // Módulo E (HU-E1/E5) → Cliente Web dueño del carrito. Por ítem de carrito:
  // bloquear dos veces el mismo ítem notifica una sola vez.
  suscripcion({
    evento: "ecommerce:carrito_articulo_no_disponible",
    prioridad_default: "ADVERTENCIA",
    armar: (p) =>
      // Un carrito de visitante no tiene destinatario.
      p.cliente_web_cuenta_id
        ? {
            clave_origen: p.carrito_item_id,
            variables: { sku: p.sku, motivo: p.motivo },
            destinatarios: { cuenta_cliente_web_ids: [p.cliente_web_cuenta_id] },
          }
        : null,
  }),
  // Módulo E (HU-E2) → Cliente Web dueño del pedido. Por pedido: un webhook
  // repetido nunca notifica dos veces.
  suscripcion({
    evento: "ecommerce:pedido_pago_confirmado",
    prioridad_default: "INFORMATIVA",
    armar: (p) => ({
      clave_origen: p.pedido_venta_id,
      variables: { numero_venta: p.numero_venta },
      destinatarios: { cuenta_cliente_web_ids: [p.cliente_web_cuenta_id] },
    }),
  }),
  suscripcion({
    evento: "ecommerce:pedido_admitido_cola",
    prioridad_default: "INFORMATIVA",
    armar: (p) => ({
      clave_origen: p.evento_id,
      variables: { pedido_venta_id: p.pedido_venta_id },
      destinatarios: { roles: ["OPERADOR_PICK_PACK"] },
    }),
  }),
  // HU-E3: E12 ya confirmó LISTO; solo la cuenta web operable recibe aviso.
  suscripcion({
    evento: "ecommerce:pedido_listo_para_retiro",
    prioridad_default: "INFORMATIVA",
    armar: (p) => p.cliente_web_cuenta_id
      ? {
          clave_origen: p.evento_id,
          variables: { numero_venta: p.numero_venta },
          destinatarios: { cuenta_cliente_web_ids: [p.cliente_web_cuenta_id] },
        }
      : null,
  }),
  suscripcion({
    evento: "ecommerce:plazo_retiro_por_vencer",
    prioridad_default: "ADVERTENCIA",
    armar: (p) => p.cliente_web_cuenta_id
      ? {
          clave_origen: p.clave_origen,
          variables: {
            numero_venta: p.numero_venta,
            plazo_retiro_vencimiento: p.plazo_retiro_vencimiento,
          },
          destinatarios: { cuenta_cliente_web_ids: [p.cliente_web_cuenta_id] },
        }
      : null,
  }),
  suscripcion({
    evento: "ecommerce:pedido_cancelado",
    prioridad_default: "ADVERTENCIA",
    armar: (p) => p.cliente_web_cuenta_id
      ? {
          clave_origen: p.reintegro_id,
          variables: { numero_venta: p.numero_venta, estado: p.estado_nuevo },
          destinatarios: { cuenta_cliente_web_ids: [p.cliente_web_cuenta_id] },
        }
      : null,
  }),
  suscripcion({
    evento: "ecommerce:pedido_vencido_sin_retiro",
    // spec_modulo_F.md §3.3 + addendum post-T17 (SPEC E §2.13.16.1).
    prioridad_default: "CRITICA",
    armar: (p) => p.cliente_web_cuenta_id
      ? {
          clave_origen: p.reintegro_id,
          variables: { numero_venta: p.numero_venta, estado: p.estado_nuevo },
          destinatarios: { cuenta_cliente_web_ids: [p.cliente_web_cuenta_id] },
        }
      : null,
  }),
];

function procesar(s: Suscripcion<keyof DomainEventMap>, payload: DomainEventMap[keyof DomainEventMap]): void {
  try {
    const generacion = s.armar(payload);
    if (!generacion) return;
    void generarNotificaciones({
      ...generacion,
      tipo_evento: s.evento,
      prioridad_default: s.prioridad_default,
    }).catch((error: unknown) => {
      console.error(`[notificacion.listener] No se pudo generar la notificación de ${s.evento}:`, error);
    });
  } catch (error) {
    console.error(`[notificacion.listener] Payload inválido para ${s.evento}:`, error);
  }
}

let iniciado = false;

export function iniciarNotificacionListener(): void {
  if (iniciado) return;
  iniciado = true;

  for (const s of SUSCRIPCIONES_NOTIFICACION) {
    domainEventBus.on(s.evento, (payload) => procesar(s, payload));
  }
}
