/**
 * @component EstadoProveedorBadge
 * @description Badge de color por estado de homologación de un Proveedor
 * (HU-H1). Punto único de verdad del mapeo estado → color, usado por
 * `TablaProveedores`. Componente puro sin estado — se renderiza tanto en
 * Server como en Client Components.
 *
 * Los 3 estados salen del enum `EstadoProveedor` de Prisma (spec §3.1).
 * Paleta `blue-*` del proyecto para el estado operativo por defecto
 * (HOMOLOGADO); PENDIENTE en ámbar y SUSPENDIDO en rojo para señalizar.
 */

import { Badge } from "@/components/ui/badge";

type EstadoProveedor = "PENDIENTE" | "HOMOLOGADO" | "SUSPENDIDO";

const ESTADO_CONFIG: Record<EstadoProveedor, { label: string; className: string }> = {
  PENDIENTE: {
    label: "Pendiente",
    className: "bg-amber-100 text-amber-700 border border-amber-200",
  },
  HOMOLOGADO: {
    label: "Homologado",
    className: "bg-blue-100 text-blue-700 border border-blue-200",
  },
  SUSPENDIDO: {
    label: "Suspendido",
    className: "bg-red-100 text-red-700 border border-red-200",
  },
};

export function EstadoProveedorBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoProveedor] ?? {
      label: estado,
      className: "bg-gray-100 text-gray-700 border border-gray-200",
    };

  return (
    <Badge className={`${config.className} font-medium`}>{config.label}</Badge>
  );
}