export const FILTRO_ACUMULADO_RECEPCIONES_ACTIVAS = {
  is_active: true,
  deleted_at: null,
  recepcion: { is_active: true, deleted_at: null },
} as const;

export interface SaldoItemRecepcion {
  cantidad_solicitada: number;
  cantidad_recibida_previa: number;
  cantidad_recibida_actual: number;
}

export function determinarEstadoFisicoOrden(
  items: SaldoItemRecepcion[],
): "RECEPCION_PARCIAL" | "RECIBIDA_COMPLETA" {
  return items.every(
    (item) =>
      item.cantidad_recibida_previa + item.cantidad_recibida_actual >=
      item.cantidad_solicitada,
  )
    ? "RECIBIDA_COMPLETA"
    : "RECEPCION_PARCIAL";
}

export interface DatosEventoRecepcionRegistrada {
  recepcion_id: string;
  orden_compra_id: string;
  numero_orden: string;
  deposito_destino_id: string;
  recibida_por_id: string;
  fecha_recepcion: Date;
  estado_anterior_oc: "CONFIRMADA" | "RECEPCION_PARCIAL";
  estado_nuevo_oc: "RECEPCION_PARCIAL" | "RECIBIDA_COMPLETA";
}

export function construirPayloadRecepcionRegistrada(datos: DatosEventoRecepcionRegistrada) {
  return { ...datos, fecha_recepcion: datos.fecha_recepcion.toISOString() };
}

