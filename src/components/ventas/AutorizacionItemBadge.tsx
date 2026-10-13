/**
 * @component AutorizacionItemBadge
 * @description Badge de estado de autorización de un `PedidoVentaItem`
 * (HU-B4, spec_modulo_B.md §2.4). Distingue los 3 estados reales del par
 * `requiere_autorizacion`/`autorizado_por_id` — `requiere_autorizacion` por
 * sí solo NO alcanza para decidir si el ítem ya fue autorizado, porque ese
 * mismo campo pasa a `false` tanto cuando nunca hubo nada pendiente como
 * cuando la autorización YA se resolvió (hallazgo de QA visual HU-B4, el
 * badge "Autorizado" nunca se renderizaba: la rama era código inalcanzable):
 *
 *  1. `requiere_autorizacion: false`, `autorizado_por_id: null`   → sin
 *     autorización pendiente ni resuelta — sin badge (`null`).
 *  2. `requiere_autorizacion: true`                                → "Pendiente
 *     de autorización" (independientemente de `autorizado_por_id`, que en
 *     este estado siempre es `null` por invariante del servicio).
 *  3. `requiere_autorizacion: false`, `autorizado_por_id` no nulo  → "Autorizado".
 */

import { Badge } from "@/components/ui/badge";

export function AutorizacionItemBadge({
  requiereAutorizacion,
  autorizadoPorId,
}: {
  requiereAutorizacion: boolean;
  autorizadoPorId: string | null;
}) {
  if (requiereAutorizacion) {
    return (
      <Badge className="bg-warning text-warning-foreground border border-warning-foreground font-medium">
        Pendiente de autorización
      </Badge>
    );
  }

  if (autorizadoPorId !== null) {
    return (
      <Badge className="bg-success text-success-foreground border border-success-foreground font-medium">
        Autorizado
      </Badge>
    );
  }

  return null;
}
