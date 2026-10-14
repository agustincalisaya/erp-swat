// STUB del PR 0: lo implementa el Cluster 6 (HU-G15). El Cluster 3 no edita este archivo.
import "server-only";

import { ServiceError } from "@/lib/errors/service-error";
import { rangoMesNegocio } from "@/lib/utils/fecha-negocio";
import type { ObtenerBloquesAdicionales } from "@/lib/services/tesoreria/reporte-mensual.types";

/**
 * Bloques adicionales del reporte mensual (HU-G15). STUB: valida el período
 * igual que `obtenerResumenMensual` y devuelve `[]`. No consulta la base.
 *
 * @throws {ServiceError} PERIODO_INVALIDO — año o mes fuera de rango
 */
export const obtenerBloquesAdicionales: ObtenerBloquesAdicionales = async (anio, mes) => {
  try {
    rangoMesNegocio(anio, mes);
  } catch (error) {
    if (error instanceof RangeError) throw new ServiceError("PERIODO_INVALIDO", error.message);
    throw error;
  }
  return [];
};
