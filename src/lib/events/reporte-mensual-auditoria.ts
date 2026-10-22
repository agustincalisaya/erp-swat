import "server-only";

import { randomUUID } from "node:crypto";
import { domainEventBus, listenersRegistrados } from "@/lib/events/domain-event-bus";
import { confirmacionesReporteMensual } from "./reporte-mensual-confirmacion";
import { ServiceError } from "@/lib/errors/service-error";
import type { ReporteMensualExportadoPayload } from "./event-types";

export async function auditarExportacionReporte(
  datos: Pick<ReporteMensualExportadoPayload, "usuario_id" | "anio" | "mes" | "formato">,
): Promise<void> {
  const exportacion_id = randomUUID();
  const espera = confirmacionesReporteMensual.esperar(exportacion_id);
  try {
    const inicializado = await Promise.race([
      listenersRegistrados.then(() => true, () => false),
      espera.resultado.then(() => false),
    ]);
    if (!inicializado || !domainEventBus.emit("tesoreria:reporte_exportado", {
      ...datos, exportacion_id, timestamp: new Date().toISOString(),
    }) || !await espera.resultado) throw new Error("AUDITORIA_NO_CONFIRMADA");
  } catch {
    throw new ServiceError("REPORTE_AUDITORIA_NO_CONFIRMADA", "No se pudo registrar la exportación. Intentá nuevamente más tarde.");
  } finally {
    espera.cancelar();
  }
}
