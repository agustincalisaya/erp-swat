import "server-only";

import { obtenerResumenMensual } from "./reporte-mensual.service";
import { mesAnterior } from "./reporte-mensual-extensiones.calculo";
import type { ObtenerResumenMensual, ResumenMensualDto } from "./reporte-mensual.types";

export interface PuntoSerieReporte {
  periodo: string;
  ingresos: string;
  egresos: string;
}

const punto = (resumen: ResumenMensualDto): PuntoSerieReporte => ({
  periodo: `${resumen.periodo.anio}-${String(resumen.periodo.mes).padStart(2, "0")}`,
  ingresos: resumen.ingresos.total,
  egresos: resumen.egresos.total,
});

/** Reutiliza el resumen visible; consulta solo los cinco meses anteriores. */
export async function obtenerSerieSeisMeses(
  seleccionado: ResumenMensualDto,
  consultar: ObtenerResumenMensual = obtenerResumenMensual,
): Promise<PuntoSerieReporte[]> {
  const periodos: { anio: number; mes: number }[] = [];
  let cursor = { anio: seleccionado.periodo.anio, mes: seleccionado.periodo.mes };
  for (let i = 0; i < 5; i++) {
    cursor = mesAnterior(cursor.anio, cursor.mes);
    periodos.unshift(cursor);
  }
  const anteriores = await Promise.all(periodos.map(({ anio, mes }) =>
    consultar(anio, mes, { incluir_desglose_gastos: false })));
  return [...anteriores.map(punto), punto(seleccionado)];
}
