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
    className: "bg-gray-100 text-gray-700 border border-gray-200",
  },
  ENVIADA: {
    label: "Enviada",
    className: "bg-blue-100 text-blue-700 border border-blue-200",
  },
  CONFIRMADA: {
    label: "Confirmada",
    className: "bg-indigo-100 text-indigo-700 border border-indigo-200",
  },
  RECEPCION_PARCIAL: {
    label: "Recepción parcial",
    className: "bg-amber-100 text-amber-700 border border-amber-200",
  },
  RECIBIDA_COMPLETA: {
    label: "Recibida completa",
    className: "bg-teal-100 text-teal-700 border border-teal-200",
  },
  CERRADA: {
    label: "Cerrada",
    className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  },
  CANCELADA: {
    label: "Cancelada",
    className: "bg-red-100 text-red-700 border border-red-200",
  },
};

export function EstadoOrdenCompraBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoOrdenCompra] ?? {
      label: estado,
      className: "bg-gray-100 text-gray-700 border border-gray-200",
    };

  return (
    <Badge className={`${config.className} font-medium`}>{config.label}</Badge>
  );
}
