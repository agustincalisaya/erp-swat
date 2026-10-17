/**
 * @component EstadoListaPrecioVersionBadge
 * @description Badge de color por estado agregado de una `ListaPrecioVersion`
 * (HU-H2, UI "Lista de Precios") — mismo patrón que
 * `EstadoOrdenCompraBadge`/`EstadoProveedorBadge` (Módulo H): punto único de
 * verdad del mapeo estado → color, componente puro sin estado. Los 4 valores
 * salen de `EstadoListaPrecioVersion` (`lista-precios.calculo.ts`).
 */

import { Badge } from "@/components/ui/badge";

type EstadoListaPrecioVersion =
  | "VIGENTE"
  | "HISTORICA"
  | "PENDIENTE_APROBACION"
  | "FUTURA";

const ESTADO_CONFIG: Record<
  EstadoListaPrecioVersion,
  { label: string; className: string }
> = {
  VIGENTE: {
    label: "Vigente",
    className: "bg-success text-success-foreground border border-success-foreground",
  },
  HISTORICA: {
    label: "Histórica",
    className: "bg-muted text-foreground border border-border",
  },
  PENDIENTE_APROBACION: {
    label: "Pendiente de aprobación",
    className: "bg-warning text-warning-foreground border border-warning-foreground",
  },
  FUTURA: {
    label: "Futura",
    className: "bg-info text-info-foreground border border-info-foreground",
  },
};

export function EstadoListaPrecioVersionBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoListaPrecioVersion] ?? {
      label: estado,
      className: "bg-muted text-foreground border border-border",
    };

  return (
    <Badge className={`${config.className} font-medium`}>{config.label}</Badge>
  );
}
