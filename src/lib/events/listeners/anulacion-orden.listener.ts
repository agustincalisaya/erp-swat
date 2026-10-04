/**
 * HU-E7 (spec_modulo_E.md §2.7; task_relos.md D3) — anulación automática de la
 * orden web cuando el job de TTL (o la liberación en línea del checkout) libera
 * una reserva vencida: reacciona SOLO a `stock:reserva_liberada` con
 * `motivo_liberacion = "TTL_VENCIDO"` y delega en el núcleo de
 * `anulacion-orden.service.ts` (sin pasar por el endpoint).
 *
 * Idempotente: varias reservas de una misma orden dan una sola anulación (las
 * siguientes encuentran el estado ya cambiado y se ignoran). Todo error se
 * captura y se loguea solo con su código: nunca rompe al emisor.
 *
 * `esperarAnulacionesPendientes()` permite a un proceso de corta vida
 * (`npm run job:reservas`) no desconectar Prisma con una anulación en curso.
 */
import "server-only";

import { domainEventBus } from "@/lib/events/domain-event-bus";
import type { ReservaLiberadaPayload } from "@/lib/events/event-types";
import { anularOrdenPorReservaVencida } from "@/lib/services/ecommerce/anulacion-orden.service";

let registrado = false;
const pendientes = new Set<Promise<void>>();

/** Diagnóstico seguro: código de `ServiceError` o Prisma; nunca el mensaje. */
function codigoDiagnostico(error: unknown): string {
  const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof codigo === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(codigo) ? codigo : "ERROR_ANULACION_AUTOMATICA";
}

/** Handler expuesto para tests: no lanza ni rechaza nunca. */
export function manejarReservaLiberada(
  payload: ReservaLiberadaPayload,
  anular: (reservaId: string) => Promise<unknown> = anularOrdenPorReservaVencida,
): Promise<void> {
  if (payload.motivo_liberacion !== "TTL_VENCIDO") return Promise.resolve();
  const tarea = Promise.resolve()
    .then(() => anular(payload.reserva_id))
    .then(
      () => undefined,
      (error: unknown) => {
        console.error("[anulacion-orden.listener] Falló la anulación automática por TTL:", {
          reserva_id: payload.reserva_id,
          codigo_error: codigoDiagnostico(error),
        });
      },
    );
  pendientes.add(tarea);
  void tarea.finally(() => pendientes.delete(tarea));
  return tarea;
}

/** Resuelve cuando terminaron todas las anulaciones automáticas en curso. */
export async function esperarAnulacionesPendientes(): Promise<void> {
  while (pendientes.size > 0) await Promise.all([...pendientes]);
}

export function iniciarAnulacionOrdenListener(): void {
  if (registrado) return;
  registrado = true;
  domainEventBus.on("stock:reserva_liberada", (payload) => {
    void manejarReservaLiberada(payload);
  });
}
