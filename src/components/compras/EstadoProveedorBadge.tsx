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
    className: "bg-warning text-warning-foreground border border-warning-foreground",
  },
  HOMOLOGADO: {
    label: "Homologado",
    className: "bg-info text-info-foreground border border-info-foreground",
  },
  SUSPENDIDO: {
    label: "Suspendido",
    className: "bg-danger-soft text-destructive border border-destructive",
  },
};

export function EstadoProveedorBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoProveedor] ?? {
      label: estado,
      className: "bg-muted text-foreground border border-border",
    };

  return (
    <Badge className={`${config.className} font-medium`}>{config.label}</Badge>
  );
}