import "server-only";
import { randomUUID } from "node:crypto";
import { domainEventBus, listenersRegistrados } from "@/lib/events/domain-event-bus";
import { confirmacionesLibroIva } from "@/lib/events/libro-iva-confirmacion";
import type { LibroIvaExportadoPayload } from "@/lib/events/event-types";
import { ServiceError } from "@/lib/errors/service-error";

/** Sin polling, retries ni acceso directo a AuditLog. También acota la inicialización. */
export async function auditarExportacionLibroIva(
  datos: Pick<LibroIvaExportadoPayload, "usuario_id" | "periodo" | "tipo_libro" | "formato">,
): Promise<void> {
  const exportacion_id = randomUUID();
  const espera = confirmacionesLibroIva.esperar(exportacion_id);
  try {
    const inicializado = await Promise.race([
      listenersRegistrados.then(() => true, () => false),
      espera.resultado.then(() => false),
    ]);
    if (!inicializado || !domainEventBus.emit("tesoreria:libro_iva_exportado", {
      ...datos, exportacion_id, timestamp: new Date().toISOString(),
    }) || !await espera.resultado) {
      throw new Error("AUDITORIA_NO_CONFIRMADA");
    }
  } catch {
    throw new ServiceError("LIBRO_IVA_AUDITORIA_NO_CONFIRMADA", "No se pudo registrar la exportación. Intentá nuevamente más tarde.");
  } finally {
    espera.cancelar();
  }
}
