/**
 * @component EstadoOperacionCCBadge
 * @description Badge de estado de una `CuentaCorrienteOperacion` (HU-B5,
 * spec_modulo_B.md §2.5). Los 3 estados salen del enum `EstadoOperacionCC`
 * — una sola fuente de verdad (`estado`), sin inferir el resultado de un par
 * de flags como el gate binario que causó el bug de `AutorizacionItemBadge`
 * (HU-B4):
 *
 *  - `RETENIDA`   → "Retenida — pendiente de autorización".
 *  - `RECHAZADA`  → "Rechazada".
 *  - `APROBADA`   → "Aprobada" (dentro del límite, `autorizado_por_id: null`)
 *                   o "Aprobada por excepción" (resuelta por un Supervisor,
 *                   `autorizado_por_id` no nulo).
 */

import { Badge } from "@/components/ui/badge";

export function EstadoOperacionCCBadge({
  estado,
  autorizadoPorId,
}: {
  estado: string;
  autorizadoPorId: string | null;
}) {
  if (estado === "RETENIDA") {
    return (
      <Badge className="bg-warning text-warning-foreground border border-warning-foreground font-medium">
        Retenida — pendiente
      </Badge>
    );
  }

  if (estado === "RECHAZADA") {
    return (
      <Badge className="bg-danger-soft text-destructive border border-destructive font-medium">
        Rechazada
      </Badge>
    );
  }

  if (estado === "APROBADA") {
    return (
      <Badge className="bg-success text-success-foreground border border-success-foreground font-medium">
        {autorizadoPorId !== null ? "Aprobada por excepción" : "Aprobada"}
      </Badge>
    );
  }

  return (
    <Badge className="bg-muted text-foreground border border-border font-medium">{estado}</Badge>
  );
}
