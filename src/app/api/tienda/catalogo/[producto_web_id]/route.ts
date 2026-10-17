/**
 * @module route — GET /api/tienda/catalogo/[producto_web_id]
 * @description HU-E1 (spec_modulo_E.md §2.1) — detalle público de un producto
 * publicado, con sus variantes (disponible + precio vigente + comprable).
 * Un producto no publicado responde 404. Sin sesión.
 */
import { NextRequest } from "next/server";
import { ProductoWebIdSchema } from "@/lib/schemas/ecommerce.schema";
import { obtenerDetalleProductoWeb } from "@/lib/services/ecommerce/catalogo-web.service";
import { respuestaError, respuestaOk, respuestaValidacion } from "@/lib/services/ecommerce/respuesta-tienda";

// Next.js 16: `params` es una Promise (misma convención que el resto de las rutas).
type Ctx = { params: Promise<{ producto_web_id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const parsed = ProductoWebIdSchema.safeParse((await ctx.params).producto_web_id);
  if (!parsed.success) return respuestaValidacion(parsed.error);
  try {
    return respuestaOk(await obtenerDetalleProductoWeb(parsed.data));
  } catch (err) {
    return respuestaError(err, "GET /api/tienda/catalogo/[producto_web_id]");
  }
}
