// Contrato compartido del Sprint 5. Lo implementa el Cluster 3 (HU-G14) y lo consumen
// HU-G16, HU-G15 (Cluster 3 y 6) y HU-D6 (Cluster 6). Cambios: pedirlos al SM y avisar en el grupo.

/**
 * Reporte mensual de ingresos y egresos de base caja (Alcance G §3.6).
 *
 * Campos en snake_case, como el resto de los DTO de Tesorería
 * (`IngresoWebResumen`, `CuentaPorPagarResumen`).
 */
import type { MedioPagoVenta } from "@prisma/client";

/**
 * Importe monetario: `Decimal` serializado con `.toFixed(2)` → `string` de 2
 * decimales fijos, nunca `number` (un valor monetario no pasa por IEEE-754).
 * Mismo criterio que `IngresoWebResumen.monto` y `CuentaPorPagarResumen.monto`.
 */
export type Importe = string;

export interface OpcionesResumenMensual {
  /** true solo si el usuario tiene tesoreria:leer_desglose_gastos. El servicio no mira roles. */
  incluir_desglose_gastos: boolean;
}

export interface IngresoPorMedioMostrador {
  /** Medio de pago de mostrador; la cuenta corriente va aparte, fuera de los totales. */
  medio: Exclude<MedioPagoVenta, "CUENTA_CORRIENTE">;
  importe: Importe;
}

export interface GastoPorCategoria {
  categoria_gasto_id: string;
  nombre: string;
  /** false si la categoría fue dada de baja después de registrar gastos del mes. */
  activa: boolean;
  importe: Importe;
}

export interface ResumenMensualDto {
  periodo: {
    anio: number;
    /** 1 a 12. */
    mes: number;
    /** ISO, día 1 00:00 en hora Argentina. */
    desde: string;
    /** ISO, día 1 del mes siguiente 00:00 en hora Argentina (exclusivo). */
    hasta: string;
  };
  ingresos: {
    /** IngresoTesoreria del mes, conciliados o pendientes. */
    web: Importe;
    /** ContraAsientoIngreso del mes (se resta). */
    reintegros_web: Importe;
    /** VentaMedioPago de ventas canal MOSTRADOR facturadas, por fecha de facturación. */
    mostrador_por_medio: IngresoPorMedioMostrador[];
    /** Suma de `mostrador_por_medio`. */
    mostrador: Importe;
    /** web − reintegros_web + mostrador. */
    total: Importe;
  };
  egresos: {
    /** CuentaPorPagar PAGADA por fecha_pago. */
    proveedores: Importe;
    /** GastoOperativo activos, por fecha del gasto. */
    gastos_operativos: Importe;
    /** null si !incluir_desglose_gastos. */
    gastos_por_categoria: GastoPorCategoria[] | null;
    /** proveedores + gastos_operativos. */
    total: Importe;
  };
  /** ingresos.total − egresos.total. */
  resultado_neto: Importe;
  /** null si ingresos.total <= 0. */
  porcentaje_egresos_sobre_ingresos: number | null;
  /** Medios CUENTA_CORRIENTE de mostrador; fuera de los totales. */
  ventas_cuenta_corriente_informativo: Importe;
}

export type ObtenerResumenMensual = (
  anio: number,
  mes: number,
  opciones: OpcionesResumenMensual,
) => Promise<ResumenMensualDto>;

/**
 * Bloque genérico que el reporte mensual muestra como tabla y que el CSV y el PDF
 * exportan al final. Lo produce HU-G15 (Cluster 6). El Cluster 3 lo muestra y
 * exporta sin conocer su contenido.
 */
export interface BloqueReporte {
  /** Identificador estable, ej. "egresos_por_proveedor". */
  clave: string;
  titulo: string;
  columnas: string[];
  /** Ya formateadas como texto; misma cantidad de celdas que `columnas`. */
  filas: string[][];
}

export type ObtenerBloquesAdicionales = (
  anio: number,
  mes: number,
  opciones: OpcionesResumenMensual,
) => Promise<BloqueReporte[]>;
