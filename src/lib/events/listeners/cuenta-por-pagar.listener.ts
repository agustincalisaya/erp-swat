import "server-only";

/**
 * @module cuenta-por-pagar.listener
 * @description HU-G8 (spec_modulo_G.md §2, §3.5, §3.6, §4.3) — listener
 * reactivo que mantiene sincronizada la máquina de estados de `CuentaPorPagar`
 * (`PROVISORIO → DEFINITIVA → PAGADA`, más `CANCELADA`) a partir del evento
 * `orden_compra:estado_cambiado` (Módulo H, HU-H3). No hay alta manual.
 *
 * PATRÓN DE REFERENCIA (spec §1): primer listener del proyecto que ESCRIBE
 * estado de dominio — vía los services de `cuenta-por-pagar.service.ts`, cada
 * uno en su propia `prisma.$transaction` — y EMITE un evento de seguimiento
 * (`cuenta_por_pagar:estado_cambiado`) POST-COMMIT. El resto de los listeners
 * solo apéndican al `AuditLog`. Futuras proyecciones entre módulos deberían
 * seguir esta estructura.
 *
 * Discrimina por `payload.accion` (NUNCA por `estado_nuevo`), vía el mapa puro
 * `resolverAccionCuentaPorPagar` (`./cuenta-por-pagar.listener.routing`):
 *   - `ENVIAR`    → `generarCuentaPorPagarProvisoria`    (§2.1 · accion CREAR)
 *   - `CERRAR`    → `consolidarCuentaPorPagarDefinitiva`  (§2.2 · accion DEFINIR)
 *   - `CANCELAR`  → `cancelarCuentaPorPagar`              (§2.3 · accion CANCELAR)
 *   - `CONFIRMAR` / cualquier otra acción → no-op
 *
 * Idempotencia y tolerancia a fallos (spec §3.5 / §3.6): guarda de registro
 * único (`let registrado = false`, mismo patrón que `audit-log.listener.ts`).
 * El handler envuelve `servicio + emit` en un `try/catch` que loguea con
 * `orden_compra_id` y NUNCA relanza hacia el bus — un rechazo sin manejar en
 * un handler del `EventEmitter` no tiene un llamador HTTP que lo reciba. No
 * hay job de conciliación en este slice: la recuperación es replay manual
 * guiado por el `console.error`.
 *
 * Se registra una única vez vía el auto-registro de `domain-event-bus.ts`
 * (segundo import dinámico, DESPUÉS del de `audit-log.listener`) — NO vía
 * `src/instrumentation.ts`. Ver el docstring de `domain-event-bus.ts` para el
 * detalle de por qué ese mecanismo no sirve en este proyecto.
 */

import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { CuentaPorPagarEstadoCambiadoPayload } from "@/lib/events/event-types";
import { resolverAccionCuentaPorPagar } from "@/lib/events/listeners/cuenta-por-pagar.listener.routing";
import {
  cancelarCuentaPorPagar,
  consolidarCuentaPorPagarDefinitiva,
  generarCuentaPorPagarProvisoria,
} from "@/lib/services/tesoreria/cuenta-por-pagar.service";

let registrado = false;

export function iniciarCuentaPorPagarListener(): void {
  if (registrado) return;
  registrado = true;

  domainEventBus.on("orden_compra:estado_cambiado", (payload) => {
    // IIFE async envuelta en try/catch: el service hace I/O (`prisma.$transaction`)
    // y el `emit` de seguimiento va DESPUÉS de que la transacción resuelve
    // (post-commit, fire-and-forget). Mismo estilo que el handler de
    // `usuario:sesion_cerrada` en `audit-log.listener.ts`.
    void (async () => {
      try {
        let resultado: CuentaPorPagarEstadoCambiadoPayload | null = null;

        switch (resolverAccionCuentaPorPagar(payload.accion)) {
          case "generar":
            resultado = await generarCuentaPorPagarProvisoria(payload);
            break;
          case "consolidar":
            resultado = await consolidarCuentaPorPagarDefinitiva(payload);
            break;
          case "cancelar":
            resultado = await cancelarCuentaPorPagar(payload);
            break;
          case "ignorar":
            return; // CONFIRMAR y cualquier acción sin efecto sobre este módulo.
        }

        // Los services retornan `null` en los no-op idempotentes (spec §3.5):
        // sin fila que tocar ⇒ sin evento de seguimiento.
        if (resultado) {
          domainEventBus.emit("cuenta_por_pagar:estado_cambiado", resultado);
        }
      } catch (error) {
        console.error(
          "[cuenta-por-pagar.listener] fallo procesando orden_compra:estado_cambiado",
          {
            orden_compra_id: payload.orden_compra_id,
            accion: payload.accion,
            error,
          },
        );
      }
    })();
  });
}
