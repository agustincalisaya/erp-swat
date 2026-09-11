import { EventEmitter } from "node:events";
import type { DomainEventMap } from "@/lib/events/event-types";

/**
 * Gateway que encapsula el bus de eventos de dominio (spec_modulo_A.md,
 * sección 4). Sprint 1: `EventEmitter` interno de proceso. Reemplazable a
 * futuro por un broker externo (ej. Redis Streams) sin acoplar el dominio
 * (patrón Adapter, RULES.md sección 4).
 *
 * Auto-registro de listeners persistentes del proceso (ver abajo): NO se usa
 * `src/instrumentation.ts` (`register()`) para esto — verificado empíricamente
 * que Next.js/Turbopack ejecuta ese hook en un grafo de módulos AISLADO del
 * que usan los Route Handlers, así que un listener registrado ahí queda
 * suscripto a una instancia de `DomainEventBus` DISTINTA de la que los
 * services usan al emitir (`emit()` medía `listenerCount=0` pese a que el
 * listener sí se había registrado al arrancar). El bus se autorregistra acá
 * mismo para garantizar que use exactamente esta instancia.
 */
class DomainEventBus extends EventEmitter {
  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends keyof DomainEventMap>(
    event: K,
    listener: (payload: DomainEventMap[K]) => void,
  ): this {
    return super.on(event, listener);
  }
}

export const domainEventBus = new DomainEventBus();

// Import DINÁMICO (no estático) para evitar un ciclo de módulos real con
// `audit-log.listener.ts` (que importa `domainEventBus` de este archivo) —
// se dispara apenas se crea el singleton de arriba, antes de que cualquier
// Route Handler llegue a emitir un evento.
void import("@/lib/events/listeners/audit-log.listener").then(({ iniciarAuditLogListener }) => {
  iniciarAuditLogListener();
});

// HU-G8 (spec_modulo_G.md §4.3) — segundo import dinámico de registro: el
// listener REACTIVO de Cuentas por Pagar. Va DESPUÉS del de `audit-log.listener`
// a propósito — el `EventEmitter` despacha a sus handlers en orden de registro,
// así el asiento de auditoría de la propia `OrdenCompra` se encola antes de que
// arranque la reacción de `CuentaPorPagar`.
void import("@/lib/events/listeners/cuenta-por-pagar.listener").then(({ iniciarCuentaPorPagarListener }) => {
  iniciarCuentaPorPagarListener();
});
