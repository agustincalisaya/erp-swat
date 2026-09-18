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
      <Badge className="bg-amber-100 text-amber-700 border border-amber-200 font-medium">
        Retenida — pendiente
      </Badge>
    );
  }

  if (estado === "RECHAZADA") {
    return (
      <Badge className="bg-red-100 text-red-700 border border-red-200 font-medium">
        Rechazada
      </Badge>
    );
  }

  if (estado === "APROBADA") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 font-medium">
        {autorizadoPorId !== null ? "Aprobada por excepción" : "Aprobada"}
      </Badge>
    );
  }

  return (
    <Badge className="bg-gray-100 text-gray-700 border border-gray-200 font-medium">{estado}</Badge>
  );
}
