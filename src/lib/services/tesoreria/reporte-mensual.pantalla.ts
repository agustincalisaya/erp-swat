import "server-only";

import { consultarReporteMensual } from "./reporte-mensual.calculo.service";
import { obtenerBloquesAdicionales } from "./reporte-mensual-extensiones.service";
import type { OpcionesResumenMensual, BloqueReporte } from "./reporte-mensual.types";

/** El fallo de G15 nunca invalida el resumen principal. */
export async function cargarReporteMensual(
  anio: number,
  mes: number,
  opciones: OpcionesResumenMensual,
  deps: {
    consultar: typeof consultarReporteMensual;
    bloques: typeof obtenerBloquesAdicionales;
  } = { consultar: consultarReporteMensual, bloques: obtenerBloquesAdicionales },
) {
  const principal = await deps.consultar(anio, mes, opciones);
  let bloques: BloqueReporte[] = [];
  let adicionalesDisponibles = true;
  try {
    bloques = await deps.bloques(anio, mes, opciones);
  } catch {
    adicionalesDisponibles = false;
  }
  return { ...principal, bloques, adicionalesDisponibles };
}
