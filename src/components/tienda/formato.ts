/** HU-E1 — Formato de precios de la tienda (pesos argentinos). */
const formateador = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

export function formatearPrecio(monto: number): string {
  return formateador.format(monto);
}

/** Lee el `error` del contrato `{ data, error }` de `app/api/tienda/**`. */
export interface ErrorApiTienda {
  code: string;
  message: string;
  details?: {
    items?: { item_id?: string; variante_sku_id: string; sku: string; motivo?: string; disponible?: number; solicitado?: number }[];
    /** HU-E2: el pedido quedó Pago Pendiente aunque falló la pasarela. */
    pedido_venta_id?: string;
  };
}
