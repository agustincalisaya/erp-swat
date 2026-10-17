/**
 * HU-E4 — GET (listar) y POST (crear) cupones de descuento (spec_modulo_E.md
 * §2.4.e). Sesión interna + `ecommerce:gestionar_cupones`; el actor sale de la
 * sesión, nunca del body.
 */
import type { NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CUPONES } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearCuponSchema, FiltroCuponesSchema } from "@/lib/schemas/cupon.schema";
import { crearCupon, listarCupones } from "@/lib/services/ecommerce/cupon.service";
import {
  leerJson,
  respuestaErrorCupones,
  respuestaOkCupones,
  respuestaValidacionCupones,
} from "@/lib/services/ecommerce/respuesta-cupones";

export const GET = withPermission(PERMISO_GESTIONAR_CUPONES, async (req: NextRequest) => {
  const params = req.nextUrl.searchParams;
  const filtro = FiltroCuponesSchema.safeParse({
    estado: params.get("estado") ?? undefined,
    q: params.get("q") ?? undefined,
  });
  if (!filtro.success) return respuestaValidacionCupones(filtro.error);
  try {
    return respuestaOkCupones({ items: await listarCupones(filtro.data) });
  } catch (error) {
    return respuestaErrorCupones(error, "GET /api/ecommerce/cupones");
  }
});

export const POST = withPermission(PERMISO_GESTIONAR_CUPONES, async (req: NextRequest, session) => {
  const input = CrearCuponSchema.safeParse(await leerJson(req));
  if (!input.success) return respuestaValidacionCupones(input.error);
  try {
    return respuestaOkCupones({ cupon: await crearCupon(input.data, session.userId) }, 201);
  } catch (error) {
    return respuestaErrorCupones(error, "POST /api/ecommerce/cupones");
  }
});
