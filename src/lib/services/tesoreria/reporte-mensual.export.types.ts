import type { ResumenMensualDto, BloqueReporte } from "./reporte-mensual.types";
import type { DetalleMovimientoMensualDto } from "./reporte-mensual.detalle.types";

export interface ReporteExportable {
  resumen: ResumenMensualDto;
  detalle: DetalleMovimientoMensualDto[];
  bloques: BloqueReporte[];
}
