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
    className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  },
  HISTORICA: {
    label: "Histórica",
    className: "bg-gray-100 text-gray-700 border border-gray-200",
  },
  PENDIENTE_APROBACION: {
    label: "Pendiente de aprobación",
    className: "bg-amber-100 text-amber-700 border border-amber-200",
  },
  FUTURA: {
    label: "Futura",
    className: "bg-blue-100 text-blue-700 border border-blue-200",
  },
};

export function EstadoListaPrecioVersionBadge({ estado }: { estado: string }) {
  const config =
    ESTADO_CONFIG[estado as EstadoListaPrecioVersion] ?? {
      label: estado,
      className: "bg-gray-100 text-gray-700 border border-gray-200",
    };

  return (
    <Badge className={`${config.className} font-medium`}>{config.label}</Badge>
  );
}
