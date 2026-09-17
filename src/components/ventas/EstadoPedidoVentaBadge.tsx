/**
 * @component EstadoPedidoVentaBadge
 * @description Badge de color por estado de un PedidoVenta (spec_modulo_B.md
 * §3.1). Usado en el detalle de Presupuesto (`/ventas/presupuestos/[id]`)
 * para mostrar el estado del pedido generado tras la aceptación — HU-B3 no
 * define una pantalla de detalle de PedidoVenta propia (fuera de alcance).
 */

import { Badge } from "@/components/ui/badge";

type EstadoPedidoVenta = "RESERVADO" | "FACTURADO" | "REMITO_EMITIDO" | "CERRADO" | "ANULADO";

const ESTADO_CONFIG: Record<EstadoPedidoVenta, { label: string; className: string }> = {
  RESERVADO: {
    label: "Reservado",
    className: "bg-blue-100 text-blue-700 border border-blue-200",
  },
  FACTURADO: {
    label: "Facturado",
    className: "bg-indigo-100 text-indigo-700 border border-indigo-200",
  },
  REMITO_EMITIDO: {
    label: "Remito emitido",
    className: "bg-amber-100 text-amber-700 border border-amber-200",
  },
  CERRADO: {
    label: "Cerrado",
    className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  },
  ANULADO: {
    label: "Anulado",
    className: "bg-red-100 text-red-700 border border-red-200",
  },
};

export function EstadoPedidoVentaBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoPedidoVenta] ?? {
      label: estado,
      className: "bg-gray-100 text-gray-700 border border-gray-200",
    };

  return <Badge className={`${config.className} font-medium`}>{config.label}</Badge>;
}
