import "server-only";
import { randomUUID } from "node:crypto";
import { domainEventBus, listenersRegistrados } from "@/lib/events/domain-event-bus";
import { confirmacionesPublicacionWeb } from "@/lib/events/publicacion-web-confirmacion";
import type { PublicacionWebRechazadaPayload } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";

/**
 * HU-E16 (spec E §6.2, E16-4) — emite `ecommerce:publicacion_web_rechazada` y
 * espera que D.3 confirme el asiento. Mismo patrón que `libro-iva-auditoria.ts`:
 * la espera se registra ANTES de emitir; sin polling, retries ni acceso directo
 * a AuditLog. Resuelve solo si el asiento quedó persistido; si no (falla,
 * timeout, sin listener o bus sin inicializar) lanza AUDITORIA_NO_DISPONIBLE.
 */
export async function auditarRechazoPublicacionWeb(
  datos: Pick<PublicacionWebRechazadaPayload, "actor_id" | "producto_web_id" | "faltantes">,
): Promise<void> {
  const intento_id = randomUUID();
  const espera = confirmacionesPublicacionWeb.esperar(intento_id);
  try {
    const inicializado = await Promise.race([
      listenersRegistrados.then(() => true, () => false),
      espera.resultado.then(() => false),
    ]);
    if (!inicializado || !domainEventBus.emit("ecommerce:publicacion_web_rechazada", {
      intento_id,
      actor_id: datos.actor_id,
      producto_web_id: datos.producto_web_id,
      faltantes: datos.faltantes,
      timestamp: new Date().toISOString(),
    }) || !await espera.resultado) {
      throw new Error("AUDITORIA_NO_CONFIRMADA");
    }
  } catch {
    console.error("[HU-E16] No se confirmó la auditoría del rechazo de publicación:", {
      producto_web_id: datos.producto_web_id,
    });
    throw new ServiceError("AUDITORIA_NO_DISPONIBLE", "No se pudo registrar el intento. Intentá nuevamente más tarde.");
  } finally {
    espera.cancelar();
  }
}
