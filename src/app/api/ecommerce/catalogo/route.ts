/**
 * HU-E11 — POST: alta del contenido web de un Producto Maestro
 * (spec_modulo_E.md §2.11; task_relos.md D4, D23). Nace oculto
 * (`visibilidad_web = false`); mostrarlo es la operación de HU-E5.
 *
 * Respuestas `{ data, error }`: 201 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PRODUCTO_MAESTRO_NO_ENCONTRADO · 409 CONTENIDO_WEB_EXISTENTE ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { CrearContenidoWebSchema } from "@/lib/schemas/ecommerce.schema";
import { crearContenidoWeb } from "@/lib/services/ecommerce/contenido-web.service";
import {
  leerJsonCatalogo,
  respuestaErrorCatalogo,
  respuestaValidacionCatalogo,
} from "@/lib/services/ecommerce/respuesta-catalogo";

export const POST = withPermission(PERMISO_GESTIONAR_CATALOGO, async (req: NextRequest, session) => {
  const input = CrearContenidoWebSchema.safeParse(await leerJsonCatalogo(req));
  if (!input.success) return respuestaValidacionCatalogo(input.error);
  try {
    const data = await crearContenidoWeb(input.data, session.userId);
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) {
    return respuestaErrorCatalogo(error, "POST /api/ecommerce/catalogo");
  }
});
