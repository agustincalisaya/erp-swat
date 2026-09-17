/**
 * @component EstadoPresupuestoBadge
 * @description Badge de color por estado de un Presupuesto (HU-B3, spec
 * §3.1). Punto único de verdad del mapeo estado → color, compartido por el
 * listado (`TablaPresupuestos`) y el detalle (`/ventas/presupuestos/[id]`).
 * Componente puro sin estado — mismo patrón que `EstadoOrdenCompraBadge`.
 *
 * Los 3 estados salen del enum `EstadoPresupuesto` de Prisma. `BORRADOR` no
 * es alcanzable por el contrato público de HU-B3 (el alta emite
 * directamente en `EMITIDO`), pero se contempla por completitud del enum.
 */

import { Badge } from "@/components/ui/badge";

type EstadoPresupuesto = "BORRADOR" | "EMITIDO" | "VENCIDO";

const ESTADO_CONFIG: Record<EstadoPresupuesto, { label: string; className: string }> = {
  BORRADOR: {
    label: "Borrador",
    className: "bg-gray-100 text-gray-700 border border-gray-200",
  },
  EMITIDO: {
    label: "Emitido",
    className: "bg-blue-100 text-blue-700 border border-blue-200",
  },
  VENCIDO: {
    label: "Vencido",
    className: "bg-red-100 text-red-700 border border-red-200",
  },
};

export function EstadoPresupuestoBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoPresupuesto] ?? {
      label: estado,
      className: "bg-gray-100 text-gray-700 border border-gray-200",
    };

  return <Badge className={`${config.className} font-medium`}>{config.label}</Badge>;
}
