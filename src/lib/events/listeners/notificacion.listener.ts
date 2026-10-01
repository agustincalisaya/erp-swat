/**
 * HU-F3 — Listener del Motor de Notificaciones (spec_modulo_F.md §2.3/§3.3).
 *
 * MÍNIMO introducido por HU-E1 (aprobado por el owner): suscribe UN solo
 * evento de la tabla §3.3 — `ecommerce:carrito_articulo_no_disponible`
 * (ADVERTENCIA, Cliente Web dueño del carrito). El owner de HU-F3 agrega acá
 * el resto de los consumidores.
 *
 * Fire-and-forget (spec F §2.3): corre después del commit de la operación de
 * origen; si la generación falla se loguea y NO revierte ni reintenta nada.
 * Registrado por import dinámico desde `domain-event-bus.ts`, igual que
 * `audit-log.listener.ts`.
 */
import { domainEventBus } from "@/lib/events/domain-event-bus";
import { generarNotificacionClienteWeb } from "@/lib/services/notificaciones/notificacion.service";

let iniciado = false;

export function iniciarNotificacionListener(): void {
  if (iniciado) return;
  iniciado = true;

  domainEventBus.on("ecommerce:carrito_articulo_no_disponible", (payload) => {
    // Un carrito de visitante no tiene destinatario: no hay a quién notificar.
    if (!payload.cliente_web_cuenta_id) return;

    void generarNotificacionClienteWeb({
      tipo_evento: "ecommerce:carrito_articulo_no_disponible",
      // Por ítem de carrito: bloquear dos veces el mismo ítem notifica una sola vez.
      registro_id: payload.carrito_item_id,
      cuenta_cliente_web_id: payload.cliente_web_cuenta_id,
      prioridad_default: "ADVERTENCIA",
      variables: { sku: payload.sku, motivo: payload.motivo },
    }).catch((error: unknown) => {
      console.error(
        "[notificacion.listener] No se pudo generar la notificación de ecommerce:carrito_articulo_no_disponible:",
        error,
      );
    });
  });
}
