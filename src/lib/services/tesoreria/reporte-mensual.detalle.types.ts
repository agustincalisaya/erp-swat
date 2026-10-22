import type { Importe } from "./reporte-mensual.types";

export type TipoMovimientoMensual = "COBRO_WEB" | "REINTEGRO_WEB" | "VENTA_MOSTRADOR" | "EGRESO_PROVEEDOR" | "GASTO_OPERATIVO";

/** Presentación individual, separada del contrato compartido de totales. */
export interface DetalleMovimientoMensualDto {
  id: string;
  fuente_id: string;
  tipo: TipoMovimientoMensual;
  fecha: string;
  concepto: string;
  importe: Importe;
  impacta_resultado: boolean;
  medio_pago?: string;
  categoria_gasto_id?: string;
  proveedor_id?: string;
}
