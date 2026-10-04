/**
 * HU-E4 — GET (ver, incluye dados de baja) y PATCH (editar con la política de
 * K4) de un cupón de descuento (spec_modulo_E.md §2.4.e).
 */
import type { NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CUPONES } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { EditarCuponSchema } from "@/lib/schemas/cupon.schema";
import { editarCupon, obtenerCupon } from "@/lib/services/ecommerce/cupon.service";
import {
  leerJson,
  respuestaErrorCupones,
  respuestaOkCupones,
  respuestaValidacionCupones,
} from "@/lib/services/ecommerce/respuesta-cupones";

type Contexto = { params: Promise<{ id: string }> };

export const GET = withPermission(PERMISO_GESTIONAR_CUPONES, async (_req: NextRequest, _session, context) => {
  const { id } = await (context as Contexto).params;
  try {
    return respuestaOkCupones({ cupon: await obtenerCupon(id) });
  } catch (error) {
    return respuestaErrorCupones(error, "GET /api/ecommerce/cupones/[id]");
  }
});

export const PATCH = withPermission(PERMISO_GESTIONAR_CUPONES, async (req: NextRequest, session, context) => {
  const input = EditarCuponSchema.safeParse(await leerJson(req));
  if (!input.success) return respuestaValidacionCupones(input.error);
  const { id } = await (context as Contexto).params;
  try {
    return respuestaOkCupones({ cupon: await editarCupon(id, input.data, session.userId) });
  } catch (error) {
    return respuestaErrorCupones(error, "PATCH /api/ecommerce/cupones/[id]");
  }
});
