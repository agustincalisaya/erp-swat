import { EventEmitter } from "node:events";
import type { DomainEventMap } from "@/lib/events/event-types";

/**
 * Gateway que encapsula el bus de eventos de dominio (spec_modulo_A.md,
 * sección 4). Sprint 1: `EventEmitter` interno de proceso. Reemplazable a
 * futuro por un broker externo (ej. Redis Streams) sin acoplar el dominio
 * (patrón Adapter, RULES.md sección 4).
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
