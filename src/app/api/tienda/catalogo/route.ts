/**
 * @module route — GET /api/tienda/catalogo
 * @description HU-E1 (spec_modulo_E.md §2.1) — listado público del catálogo
 * online con disponibilidad del depósito del canal web y precio vigente
 * (HU-B9), en tiempo real (sin cache: CA1/CA2). Sin sesión.
 */
import { NextRequest } from "next/server";
import { ListarCatalogoQuerySchema } from "@/lib/schemas/ecommerce.schema";
import { listarCatalogo } from "@/lib/services/ecommerce/catalogo-web.service";
import { respuestaError, respuestaOk, respuestaValidacion } from "@/lib/services/ecommerce/respuesta-tienda";

export async function GET(req: NextRequest) {
  const parsed = ListarCatalogoQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return respuestaValidacion(parsed.error);
  try {
    return respuestaOk(await listarCatalogo(parsed.data));
  } catch (err) {
    return respuestaError(err, "GET /api/tienda/catalogo");
  }
}
