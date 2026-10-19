import "server-only";

import { consultarReporteMensual } from "./reporte-mensual.calculo.service";
import type { ObtenerResumenMensual, OpcionesResumenMensual } from "./reporte-mensual.types";
import type { DetalleMovimientoMensualDto } from "./reporte-mensual.detalle.types";

/** Alcance G §5: lectura de reportes financieros y de la posición diaria. */
export const PERMISO_LEER_REPORTES = "tesoreria:leer_reportes";
export const PERMISO_LEER_DESGLOSE_GASTOS = "tesoreria:leer_desglose_gastos";

export const obtenerResumenMensual: ObtenerResumenMensual = async (anio, mes, opciones) =>
  (await consultarReporteMensual(anio, mes, opciones)).resumen;

/** Las filas individuales no forman parte de ResumenMensualDto. */
export async function obtenerDetalleMovimientosMensuales(
  anio: number, mes: number, opciones: OpcionesResumenMensual,
): Promise<DetalleMovimientoMensualDto[]> {
  return (await consultarReporteMensual(anio, mes, opciones)).detalle;
}
