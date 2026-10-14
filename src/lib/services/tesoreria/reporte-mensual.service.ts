// STUB del PR 0: lo reemplaza el Cluster 3 (HU-G14). No agregar lógica acá fuera de esa HU.
import "server-only";

import { ServiceError } from "@/lib/errors/service-error";
import { rangoMesNegocio } from "@/lib/utils/fecha-negocio";
import type { ObtenerResumenMensual, ResumenMensualDto } from "@/lib/services/tesoreria/reporte-mensual.types";

/** Alcance G §5: lectura de reportes financieros y de la posición diaria. */
export const PERMISO_LEER_REPORTES = "tesoreria:leer_reportes";

const CERO = "0.00";

/**
 * Resumen mensual de base caja (HU-G14). STUB: valida el período, arma
 * `periodo` en hora de Argentina y devuelve todo en cero. No consulta la base.
 *
 * @throws {ServiceError} PERIODO_INVALIDO — año o mes fuera de rango
 */
export const obtenerResumenMensual: ObtenerResumenMensual = async (anio, mes, opciones) => {
  let rango;
  try {
    rango = rangoMesNegocio(anio, mes);
  } catch (error) {
    if (error instanceof RangeError) throw new ServiceError("PERIODO_INVALIDO", error.message);
    throw error;
  }

  const resumen: ResumenMensualDto = {
    periodo: { anio, mes, desde: rango.desde.toISOString(), hasta: rango.hasta.toISOString() },
    ingresos: { web: CERO, reintegros_web: CERO, mostrador_por_medio: [], mostrador: CERO, total: CERO },
    egresos: {
      proveedores: CERO,
      gastos_operativos: CERO,
      gastos_por_categoria: opciones.incluir_desglose_gastos ? [] : null,
      total: CERO,
    },
    resultado_neto: CERO,
    porcentaje_egresos_sobre_ingresos: null,
    ventas_cuenta_corriente_informativo: CERO,
  };
  return resumen;
};
