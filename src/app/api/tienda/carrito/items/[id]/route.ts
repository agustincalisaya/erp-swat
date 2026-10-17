/**
 * @module route — PATCH | DELETE /api/tienda/carrito/items/[id]
 * @description HU-E1 (spec_modulo_E.md §2.1) — cambiar la cantidad o quitar un
 * artículo del carrito propio (visitante o cuenta). `DELETE` es nomenclatura
 * REST: internamente es BAJA LÓGICA del ítem, nunca un borrado físico
 * (spec §2.1, "Nota de nomenclatura de ruta"; RULES.md Regla N.° 1).
 * Un ítem de otro carrito responde 404.
 */
import { NextRequest } from "next/server";
import { ActualizarCantidadCarritoSchema, ItemCarritoIdSchema } from "@/lib/schemas/ecommerce.schema";
import { actualizarCantidadCarrito, quitarDelCarrito } from "@/lib/services/ecommerce/carrito.service";
import { resolverContextoTienda } from "@/lib/services/ecommerce/contexto-tienda";
import { respuestaError, respuestaOk, respuestaValidacion } from "@/lib/services/ecommerce/respuesta-tienda";

// Next.js 16: `params` es una Promise (misma convención que el resto de las rutas).
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const id = ItemCarritoIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return respuestaValidacion(id.error);
  const body = ActualizarCantidadCarritoSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return respuestaValidacion(body.error);
  try {
    const { carrito } = await resolverContextoTienda();
    return respuestaOk(await actualizarCantidadCarrito(carrito, id.data, body.data));
  } catch (err) {
    return respuestaError(err, "PATCH /api/tienda/carrito/items/[id]");
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const id = ItemCarritoIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return respuestaValidacion(id.error);
  try {
    const { carrito } = await resolverContextoTienda();
    return respuestaOk(await quitarDelCarrito(carrito, id.data));
  } catch (err) {
    return respuestaError(err, "DELETE /api/tienda/carrito/items/[id]");
  }
}
