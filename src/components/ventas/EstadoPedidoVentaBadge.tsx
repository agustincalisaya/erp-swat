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
    className: "bg-info text-info-foreground border border-info-foreground",
  },
  FACTURADO: {
    label: "Facturado",
    className: "bg-info text-info-foreground border border-info-foreground",
  },
  REMITO_EMITIDO: {
    label: "Remito emitido",
    className: "bg-warning text-warning-foreground border border-warning-foreground",
  },
  CERRADO: {
    label: "Cerrado",
    className: "bg-success text-success-foreground border border-success-foreground",
  },
  ANULADO: {
    label: "Anulado",
    className: "bg-danger-soft text-destructive border border-destructive",
  },
};

export function EstadoPedidoVentaBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoPedidoVenta] ?? {
      label: estado,
      className: "bg-muted text-foreground border border-border",
    };

  return <Badge className={`${config.className} font-medium`}>{config.label}</Badge>;
}
