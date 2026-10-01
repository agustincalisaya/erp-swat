/**
 * @module route — POST /api/tienda/carrito/items
 * @description HU-E1 (spec_modulo_E.md §2.1) — agregar un artículo al carrito.
 * Sin sesión crea (si hace falta) un carrito de visitante y su cookie firmada.
 */
import { NextRequest } from "next/server";
import { AgregarAlCarritoSchema } from "@/lib/schemas/ecommerce.schema";
import { agregarAlCarrito } from "@/lib/services/ecommerce/carrito.service";
import { aplicarCookieCarrito, resolverContextoTienda } from "@/lib/services/ecommerce/contexto-tienda";
import { respuestaError, respuestaOk, respuestaValidacion } from "@/lib/services/ecommerce/respuesta-tienda";

export async function POST(req: NextRequest) {
  const parsed = AgregarAlCarritoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return respuestaValidacion(parsed.error);
  try {
    const { carrito } = await resolverContextoTienda();
    const resultado = await agregarAlCarrito(carrito, parsed.data);
    const response = respuestaOk(resultado.carrito, 201);
    if (resultado.token_nuevo) aplicarCookieCarrito(response, resultado.token_nuevo);
    return response;
  } catch (err) {
    return respuestaError(err, "POST /api/tienda/carrito/items");
  }
}
