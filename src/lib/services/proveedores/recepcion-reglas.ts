export interface DatosEventoRecepcionRegistrada {
  recepcion_id: string;
  orden_compra_id: string;
  numero_orden: string;
  deposito_destino_id: string;
  recibida_por_id: string;
  fecha_recepcion: Date;
  estado_anterior_oc: "CONFIRMADA";
  estado_nuevo_oc: "RECIBIDA_COMPLETA";
}

export interface ItemOrdenParaRecepcionPerfecta {
  id: string;
  variante_sku_id: string;
  cantidad_solicitada: number;
}

export const MAX_ORDENES_RECEPCIONABLES = 10;

export interface FiltrosOrdenesRecepcionables {
  proveedorId?: string;
  fechaEmision?: string | Date;
  page?: number;
  limit?: number;
}

export const FILTRO_BASE_ORDEN_RECEPCIONABLE = {
  estado: "CONFIRMADA",
  is_active: true,
  deleted_at: null,
  items: {
    some: { is_active: true, deleted_at: null },
  },
} as const;

export function construirRangoFechaEmision(fecha: string | Date) {
  const fechaBase = typeof fecha === "string"
    ? new Date(`${fecha}T00:00:00.000Z`)
    : fecha;
  if (Number.isNaN(fechaBase.getTime())) {
    throw new RangeError("La fecha de emisión no es válida");
  }

  const inicio = new Date(Date.UTC(
    fechaBase.getUTCFullYear(),
    fechaBase.getUTCMonth(),
    fechaBase.getUTCDate(),
  ));
  const fin = new Date(inicio);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return { gte: inicio, lt: fin };
}

export function construirConsultaOrdenesRecepcionables(
  filtros: FiltrosOrdenesRecepcionables = {},
  total?: number,
) {
  const limiteSolicitado = Number.isFinite(filtros.limit)
    ? Math.max(1, Math.trunc(filtros.limit!))
    : MAX_ORDENES_RECEPCIONABLES;
  const pageSize = Math.min(limiteSolicitado, MAX_ORDENES_RECEPCIONABLES);
  const paginaSolicitada = Number.isFinite(filtros.page)
    ? Math.max(1, Math.trunc(filtros.page!))
    : 1;
  const totalPages = total === undefined ? undefined : Math.ceil(total / pageSize);
  const page = totalPages === undefined
    ? paginaSolicitada
    : totalPages === 0
      ? 1
      : Math.min(paginaSolicitada, totalPages);

  return {
    where: {
      ...FILTRO_BASE_ORDEN_RECEPCIONABLE,
      ...(filtros.proveedorId ? { proveedor_id: filtros.proveedorId } : {}),
      ...(filtros.fechaEmision
        ? { fecha_emision: construirRangoFechaEmision(filtros.fechaEmision) }
        : {}),
    },
    orderBy: [
      { fecha_emision: "desc" as const },
      { numero_orden: "desc" as const },
    ],
    skip: (page - 1) * pageSize,
    take: pageSize,
    page,
    pageSize,
    totalPages,
  };
}

export function construirQueryRecepciones({
  proveedorId,
  fechaEmision,
  page = 1,
  ordenCompraId,
}: {
  proveedorId?: string;
  fechaEmision?: string;
  page?: number;
  ordenCompraId?: string;
}): string {
  const params = new URLSearchParams();
  if (proveedorId) params.set("proveedor_id", proveedorId);
  if (fechaEmision) params.set("fecha_emision", fechaEmision);
  if (page > 1) params.set("page", String(page));
  if (ordenCompraId) params.set("orden_compra_id", ordenCompraId);
  return params.toString();
}

export function construirItemsRecepcionPerfecta(items: ItemOrdenParaRecepcionPerfecta[]) {
  return items.map((item) => ({
    orden_compra_item_id: item.id,
    variante_sku_id: item.variante_sku_id,
    cantidad_recibida: item.cantidad_solicitada,
    cantidad_aceptada: item.cantidad_solicitada,
  }));
}

export function construirPayloadRecepcionRegistrada(datos: DatosEventoRecepcionRegistrada) {
  return { ...datos, fecha_recepcion: datos.fecha_recepcion.toISOString() };
}

