import "server-only";

/**
 * @module ingreso-tesoreria.listener
 * @description HU-G11 (spec_modulo_G.md §2.6) — listener reactivo que registra
 * un `IngresoTesoreria` por cada cobro online confirmado de Mercado Pago.
 *
 * PATRÓN DE REFERENCIA (spec §1): mismo esquema que
 * `cuenta-por-pagar.listener.ts` — guard de registro único
 * (`let registrado = false`), handler envuelto en una IIFE async con
 * `try/catch` que loguea y NUNCA relanza hacia el bus (un rechazo sin manejar
 * en un handler del `EventEmitter` no tiene un llamador HTTP que lo reciba) y
 * emisión del evento de seguimiento POST-COMMIT (el service abre su propia
 * `prisma.$transaction` y retorna el payload; el listener emite al resolver).
 *
 * DESVIACIÓN DE CONTRATO documentada: `spec_modulo_G.md` §2.6 manda consumir
 * `ecommerce:transaccion_pago_registrada`. Ese evento hoy SÍ existe (lo emite
 * HU-E6 post-commit, en aprobados y rechazados), pero G11 escucha
 * `ecommerce:pedido_pago_confirmado` (`PedidoPagoConfirmadoPayload`, HU-E2):
 * solo se emite con el pago confirmado y trae `fecha_aprobacion`, que el
 * payload de E6 no tiene. Decisión registrada en
 * `docs/specs/hu-f1-divergencias-evento.md` y en
 * `docs/tasks/HU-E2-integracion.md` §9 (P-R3).
 *
 * Una falla del listener NO revierte la venta (el pago ya está confirmado): se
 * loguea con `pedido_venta_id` + `mercadopago_payment_id` y queda recuperable
 * por `POST /api/tesoreria/ingresos-web/reprocesar` (no hay cola de reintentos
 * en el proyecto — decisión documentada en spec §2.6).
 *
 * Se registra una única vez vía el auto-registro de `domain-event-bus.ts`
 * (quinto import dinámico, DESPUÉS de los existentes) — NO vía
 * `src/instrumentation.ts`. Ver el docstring de `domain-event-bus.ts` para el
 * detalle de por qué ese mecanismo no sirve en este proyecto.
 */

import { domainEventBus } from "@/lib/events/domain-event-bus";
import { registrarIngresoWeb } from "@/lib/services/tesoreria/ingreso-tesoreria.service";

let registrado = false;

export function iniciarIngresoTesoreriaListener(): void {
  if (registrado) return;
  registrado = true;

  domainEventBus.on("ecommerce:pedido_pago_confirmado", (payload) => {
    // IIFE async envuelta en try/catch: el service hace I/O
    // (`prisma.$transaction`) y el `emit` de seguimiento va DESPUÉS de que la
    // transacción resuelve (post-commit, fire-and-forget).
    void (async () => {
      try {
        const resultado = await registrarIngresoWeb(payload);
        // `null` en los no-op idempotentes (reintento del webhook o del
        // reproceso): sin fila nueva ⇒ sin evento de seguimiento.
        if (resultado) {
          domainEventBus.emit("tesoreria:ingreso_web_registrado", resultado);
        }
      } catch (error) {
        console.error(
          "[ingreso-tesoreria.listener] fallo procesando ecommerce:pedido_pago_confirmado",
          {
            pedido_venta_id: payload.pedido_venta_id,
            mercadopago_payment_id: payload.mercadopago_payment_id,
            error,
          },
        );
      }
    })();
  });
}
