// HU-G15 (Cluster 6) implementa este contrato del PR 0. El Cluster 3 no edita este archivo.
import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { rangoMesFechaSolo, rangoMesNegocio } from "@/lib/utils/fecha-negocio";
import { obtenerResumenMensual } from "@/lib/services/tesoreria/reporte-mensual.service";
import {
  agruparPagosPorProveedor,
  armarBloqueComparacion,
  armarBloqueEgresosPorProveedor,
  fechaPagoEnMes,
  importeACentavos,
  mesAnterior,
  type PagoProveedor,
  type PeriodoMes,
  type TotalesMes,
} from "@/lib/services/tesoreria/reporte-mensual-extensiones.calculo";
import type {
  BloqueReporte,
  ObtenerBloquesAdicionales,
  ObtenerResumenMensual,
  OpcionesResumenMensual,
} from "@/lib/services/tesoreria/reporte-mensual.types";

/**
 * Bloques adicionales del reporte mensual (HU-G15, `spec_modulo_G.md` §9.10):
 * «Egresos por proveedor» y «Comparación con el mes anterior», en ese orden y
 * siempre los dos. El Cluster 3 los muestra y exporta sin conocer su contenido;
 * la autorización (`tesoreria:leer_reportes` / `tesoreria:exportar_reportes`)
 * la aplica quien llama. El cálculo y el formato de las celdas viven en
 * `reporte-mensual-extensiones.calculo.ts`.
 *
 * Decisiones (task de HU-G15, §0.5 y §0.7; se repiten acá porque el task no se
 * versiona):
 * - D1: la columna cuenta pagos (cuentas por pagar `PAGADA`), no comprobantes
 *   de proveedor (rige el Backlog sobre la spec G15-2).
 * - D3: la comparación consume `obtenerResumenMensual` de HU-G14 para el mes y
 *   el anterior, siempre con `incluir_desglose_gastos: false`, y usa
 *   `ingresos.total`, `egresos.total` y `resultado_neto` tal cual, sin
 *   recalcular. Los bloques no incluyen desglose de gastos, así que `opciones`
 *   no cambia el resultado.
 * - A1/D9: `fecha_pago` tiene convención mixta (la UI guarda medianoche UTC del
 *   día elegido; la API sin fecha guarda el instante). La consulta pide el
 *   rango que cubre las dos lecturas y `fechaPagoEnMes` (`diaDeVigencia`)
 *   decide el mes de cada pago. HU-G14 tiene que usar la misma regla.
 * - A10/A11: el proveedor sale de `orden_compra.proveedor`; no se filtra por
 *   baja lógica de la orden ni del proveedor (excepción a RULES §1, ver abajo).
 * - Errores: un `ServiceError` de HU-G14 se propaga tal cual; cualquier otra
 *   falla de HU-G14 es `RESUMEN_MENSUAL_NO_DISPONIBLE` y una falla de la
 *   consulta de pagos es `EGRESOS_PROVEEDORES_NO_DISPONIBLE`. Nunca se
 *   devuelven bloques parciales.
 */

export interface DependenciasBloquesAdicionales {
  cliente: Pick<PrismaClient, "cuentaPorPagar">;
  /** HU-G14 (contrato del PR 0). */
  obtenerResumenMensual: ObtenerResumenMensual;
}

const DEPENDENCIAS_REALES: DependenciasBloquesAdicionales = {
  cliente: prisma,
  obtenerResumenMensual,
};

const SIN_DESGLOSE: OpcionesResumenMensual = { incluir_desglose_gastos: false };

/** Diagnóstico seguro para el log: código de `ServiceError` o Prisma; nunca el mensaje ni datos. */
function codigoDiagnostico(error: unknown): string {
  const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof codigo === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(codigo) ? codigo : "SIN_CODIGO";
}

/**
 * Cuentas por pagar `PAGADA` activas cuyo pago corresponde al mes, atribuidas
 * al proveedor de su orden de compra.
 *
 * Una sola consulta por el rango que cubre las dos lecturas de `fecha_pago`
 * (día calendario y instante en hora de Argentina); el mes exacto lo decide
 * `fechaPagoEnMes` en código.
 *
 * Excepción justificada a RULES §1: no se filtra por `orden_compra.is_active`
 * ni por baja lógica del proveedor. Son datos históricos de pagos: un pago
 * hecho sigue siendo un egreso del mes aunque después se dé de baja el
 * proveedor o la orden. Sí se exige la cuenta activa (spec G14-6).
 *
 * @throws {RangeError} si el período no es válido
 * @throws {Error} si una cuenta no se puede atribuir a un proveedor
 */
export async function consultarPagosProveedoresDelMes(
  cliente: DependenciasBloquesAdicionales["cliente"],
  anio: number,
  mes: number,
): Promise<PagoProveedor[]> {
  const fechaSolo = rangoMesFechaSolo(anio, mes);
  const negocio = rangoMesNegocio(anio, mes);
  const desde = fechaSolo.desde < negocio.desde ? fechaSolo.desde : negocio.desde;
  const hasta = fechaSolo.hasta > negocio.hasta ? fechaSolo.hasta : negocio.hasta;

  const filas = await cliente.cuentaPorPagar.findMany({
    where: { estado: "PAGADA", is_active: true, fecha_pago: { gte: desde, lt: hasta } },
    select: {
      id: true,
      monto: true,
      fecha_pago: true,
      orden_compra: { select: { proveedor: { select: { id: true, razon_social: true } } } },
    },
  });

  const pagos: PagoProveedor[] = [];
  for (const fila of filas) {
    if (fila.fecha_pago === null || !fechaPagoEnMes(fila.fecha_pago, anio, mes)) continue;
    const proveedor = fila.orden_compra?.proveedor;
    if (!proveedor) {
      // El schema no lo permite (relaciones obligatorias); si pasara, el total
      // por proveedor dejaría de cuadrar con HU-G14, así que no se ignora.
      throw new Error(`La cuenta por pagar ${fila.id} no tiene proveedor atribuible`);
    }
    pagos.push({ proveedor_id: proveedor.id, razon_social: proveedor.razon_social, monto: fila.monto.toFixed(2) });
  }
  return pagos;
}

/**
 * Totales de HU-G14 para un mes, tal cual. Un DTO cuyos importes no tengan la
 * forma del contrato (`-?\d+\.\d{2}`) cuenta como falla de HU-G14: se detecta
 * acá y no al formatear las celdas.
 */
async function resumenDelMes(deps: DependenciasBloquesAdicionales, periodo: PeriodoMes): Promise<TotalesMes> {
  try {
    const resumen = await deps.obtenerResumenMensual(periodo.anio, periodo.mes, SIN_DESGLOSE);
    const totales: TotalesMes = {
      ...periodo,
      ingresos: resumen.ingresos.total,
      egresos: resumen.egresos.total,
      resultado_neto: resumen.resultado_neto,
    };
    importeACentavos(totales.ingresos);
    importeACentavos(totales.egresos);
    importeACentavos(totales.resultado_neto);
    return totales;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    console.error("[reporte-mensual-extensiones] HU-G14 no devolvió el resumen mensual:", {
      periodo,
      codigo_error: codigoDiagnostico(error),
    });
    throw new ServiceError("RESUMEN_MENSUAL_NO_DISPONIBLE", "No se pudo obtener el resumen mensual para comparar");
  }
}

async function pagosDelMes(deps: DependenciasBloquesAdicionales, periodo: PeriodoMes): Promise<PagoProveedor[]> {
  try {
    return await consultarPagosProveedoresDelMes(deps.cliente, periodo.anio, periodo.mes);
  } catch (error) {
    console.error("[reporte-mensual-extensiones] No se pudieron consultar los pagos a proveedores:", {
      periodo,
      codigo_error: codigoDiagnostico(error),
    });
    throw new ServiceError("EGRESOS_PROVEEDORES_NO_DISPONIBLE", "No se pudieron obtener los egresos por proveedor");
  }
}

/**
 * Implementación de `obtenerBloquesAdicionales` con dependencias inyectables
 * (por defecto, Prisma y el HU-G14 real). `opciones` no cambia el resultado.
 *
 * @throws {ServiceError} PERIODO_INVALIDO — año o mes fuera de rango, o mes anterior inexistente
 * @throws {ServiceError} el que lance HU-G14, tal cual
 * @throws {ServiceError} RESUMEN_MENSUAL_NO_DISPONIBLE — otra falla de HU-G14
 * @throws {ServiceError} EGRESOS_PROVEEDORES_NO_DISPONIBLE — falla de la consulta de pagos
 */
export async function generarBloquesAdicionales(
  anio: number,
  mes: number,
  _opciones: OpcionesResumenMensual,
  deps: Partial<DependenciasBloquesAdicionales> = {},
): Promise<BloqueReporte[]> {
  const dependencias: DependenciasBloquesAdicionales = { ...DEPENDENCIAS_REALES, ...deps };

  let anterior: PeriodoMes;
  try {
    // Valida el período (misma regla que `rangoMesNegocio`) y su mes anterior.
    anterior = mesAnterior(anio, mes);
  } catch (error) {
    if (error instanceof RangeError) throw new ServiceError("PERIODO_INVALIDO", error.message);
    throw error;
  }

  const actual: PeriodoMes = { anio, mes };
  const [totalesActual, totalesAnterior, pagos] = await Promise.all([
    resumenDelMes(dependencias, actual),
    resumenDelMes(dependencias, anterior),
    pagosDelMes(dependencias, actual),
  ]);

  return [
    armarBloqueEgresosPorProveedor(agruparPagosPorProveedor(pagos)),
    armarBloqueComparacion(totalesActual, totalesAnterior),
  ];
}

/** Contrato del PR 0: lo llama el reporte mensual del Cluster 3 (pantalla, CSV y PDF). */
export const obtenerBloquesAdicionales: ObtenerBloquesAdicionales = (anio, mes, opciones) =>
  generarBloquesAdicionales(anio, mes, opciones);
