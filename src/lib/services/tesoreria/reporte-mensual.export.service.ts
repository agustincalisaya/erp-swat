import "server-only";

import { consultarReporteMensual } from "./reporte-mensual.calculo.service";
import { obtenerBloquesAdicionales } from "./reporte-mensual-extensiones.service";
import { serializarReporteCsv } from "./reporte-mensual.csv";
import { generarReporteMensualPdf } from "./reporte-mensual.pdf";
import { auditarExportacionReporte } from "@/lib/events/reporte-mensual-auditoria";
import { ServiceError } from "@/lib/errors/service-error";
import type { OpcionesResumenMensual } from "./reporte-mensual.types";
import type { ReporteExportable } from "./reporte-mensual.export.types";

export const PERMISO_EXPORTAR_REPORTES = "tesoreria:exportar_reportes";
export type FormatoReporte = "CSV" | "PDF";

interface DependenciasExportacion {
  consultar: typeof consultarReporteMensual;
  bloques: typeof obtenerBloquesAdicionales;
  csv: typeof serializarReporteCsv;
  pdf: typeof generarReporteMensualPdf;
  auditar: typeof auditarExportacionReporte;
}

const reales: DependenciasExportacion = {
  consultar: consultarReporteMensual, bloques: obtenerBloquesAdicionales,
  csv: serializarReporteCsv, pdf: generarReporteMensualPdf, auditar: auditarExportacionReporte,
};

/** Genera el archivo completo y confirma su asiento antes de entregarlo al HTTP. */
export async function exportarReporteMensual(
  anio: number, mes: number, opciones: OpcionesResumenMensual,
  formato: FormatoReporte, usuario_id: string,
  deps: DependenciasExportacion = reales,
): Promise<{ bytes: Uint8Array; reporte: ReporteExportable }> {
  const principal = await deps.consultar(anio, mes, opciones);
  let bloques: ReporteExportable["bloques"];
  try {
    bloques = await deps.bloques(anio, mes, opciones);
  } catch {
    throw new ServiceError("REPORTE_BLOQUES_NO_DISPONIBLES", "No se pudo completar la exportación. Intentá nuevamente más tarde.");
  }
  const reporte = { ...principal, bloques };
  const bytes = formato === "CSV" ? deps.csv(reporte) : await deps.pdf(reporte);
  await deps.auditar({ usuario_id, anio, mes, formato });
  return { bytes, reporte };
}
