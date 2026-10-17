/**
 * HU-E4 — Desglose del descuento por cupón en las páginas de checkout de la
 * tienda. Solo muestra lo que el pedido ya guarda (sin recalcular): `total` es
 * el neto y `subtotal` = `total` + `monto_descontado`.
 */
import { formatearPrecio } from "@/components/tienda/formato";

export interface CuponAplicadoVista {
  codigo: string;
  monto_descontado: number;
  subtotal: number;
}

export function DesgloseCupon({ cupon, total }: { cupon: CuponAplicadoVista; total: number }) {
  return (
    <dl className="space-y-1 rounded-lg border p-4 text-sm" aria-label="Detalle del descuento">
      <div className="flex justify-between">
        <dt>Subtotal</dt>
        <dd>{formatearPrecio(cupon.subtotal)}</dd>
      </div>
      <div className="flex justify-between">
        <dt>Cupón {cupon.codigo}</dt>
        <dd>−{formatearPrecio(cupon.monto_descontado)}</dd>
      </div>
      <div className="flex justify-between font-semibold">
        <dt>Total</dt>
        <dd>{formatearPrecio(total)}</dd>
      </div>
    </dl>
  );
}
