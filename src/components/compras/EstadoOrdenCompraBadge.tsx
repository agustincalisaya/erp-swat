/**
 * @component EstadoOrdenCompraBadge
 * @description Badge de color por estado de una Orden de Compra (HU-H3).
 * Punto único de verdad del mapeo estado → color, compartido por la grilla
 * (`TablaOrdenesCompra`) y el detalle (`/compras/ordenes/[id]`). Componente
 * puro sin estado — se renderiza tanto en Server como en Client Components.
 *
 * Los 7 estados salen del enum `EstadoOrdenCompra` de Prisma (spec §3.1).
 * RECEPCION_PARCIAL / RECIBIDA_COMPLETA se muestran (una orden puede llegar
 * a esos estados por HU-H4), pero esta HU no dispara esas transiciones.
 */

import { Badge } from "@/components/ui/badge";

type EstadoOrdenCompra =
  | "BORRADOR"
  | "ENVIADA"
  | "CONFIRMADA"
  | "RECEPCION_PARCIAL"
  | "RECIBIDA_COMPLETA"
  | "CERRADA"
  | "CANCELADA";

const ESTADO_CONFIG: Record<
  EstadoOrdenCompra,
  { label: string; className: string }
> = {
  BORRADOR: {
    label: "Borrador",
    className: "bg-muted text-foreground border border-border",
  },
  ENVIADA: {
    label: "Enviada",
    className: "bg-info text-info-foreground border border-info-foreground",
  },
  CONFIRMADA: {
    label: "Confirmada",
    className: "bg-info text-info-foreground border border-info-foreground",
  },
  RECEPCION_PARCIAL: {
    label: "Recepción parcial",
    className: "bg-warning text-warning-foreground border border-warning-foreground",
  },
  RECIBIDA_COMPLETA: {
    label: "Recibida completa",
    className: "bg-success text-success-foreground border border-success-foreground",
  },
  CERRADA: {
    label: "Cerrada",
    className: "bg-success text-success-foreground border border-success-foreground",
  },
  CANCELADA: {
    label: "Cancelada",
    className: "bg-danger-soft text-destructive border border-destructive",
  },
};

export function EstadoOrdenCompraBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoOrdenCompra] ?? {
      label: estado,
      className: "bg-muted text-foreground border border-border",
    };

  return (
    <Badge className={`${config.className} font-medium`}>{config.label}</Badge>
  );
}
