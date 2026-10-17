/**
 * HU-E4 — PATCH: baja manual de un cupón de descuento (spec_modulo_E.md
 * §2.4.e). Repetida sobre uno ya dado de baja: 200 sin cambios ni evento.
 */
import type { NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CUPONES } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { BajaCuponSchema } from "@/lib/schemas/cupon.schema";
import { darDeBajaCupon } from "@/lib/services/ecommerce/cupon.service";
import {
  leerJson,
  respuestaErrorCupones,
  respuestaOkCupones,
  respuestaValidacionCupones,
} from "@/lib/services/ecommerce/respuesta-cupones";

type Contexto = { params: Promise<{ id: string }> };

export const PATCH = withPermission(PERMISO_GESTIONAR_CUPONES, async (req: NextRequest, session, context) => {
  const input = BajaCuponSchema.safeParse(await leerJson(req));
  if (!input.success) return respuestaValidacionCupones(input.error);
  const { id } = await (context as Contexto).params;
  try {
    return respuestaOkCupones({ cupon: await darDeBajaCupon(id, input.data.motivo, session.userId) });
  } catch (error) {
    return respuestaErrorCupones(error, "PATCH /api/ecommerce/cupones/[id]/baja");
  }
});
