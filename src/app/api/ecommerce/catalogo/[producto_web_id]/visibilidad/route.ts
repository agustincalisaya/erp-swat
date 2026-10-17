/**
 * HU-E5 — PATCH: ocultar / mostrar un contenido en la tienda web
 * (spec_modulo_E.md §2.5). UPDATE reversible de `visibilidad_web`, motivo
 * opcional. Repetir el valor actual: 200 sin cambios ni evento (D2).
 *
 * Respuestas `{ data, error }`: 200 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PRODUCTO_WEB_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import type { NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { CambiarVisibilidadWebSchema } from "@/lib/schemas/ecommerce.schema";
import {
  leerJsonCatalogo,
  parsearProductoWebId,
  respuestaErrorCatalogo,
  respuestaOkCatalogo,
  respuestaValidacionCatalogo,
} from "@/lib/services/ecommerce/respuesta-catalogo";
import { cambiarVisibilidadWeb } from "@/lib/services/ecommerce/visibilidad-web.service";

type Contexto = { params: Promise<{ producto_web_id: string }> };

export const PATCH = withPermission(PERMISO_GESTIONAR_CATALOGO, async (req: NextRequest, session, context) => {
  const id = parsearProductoWebId((await (context as Contexto).params).producto_web_id);
  if (!id.success) return respuestaValidacionCatalogo(id.error);
  const input = CambiarVisibilidadWebSchema.safeParse(await leerJsonCatalogo(req));
  if (!input.success) return respuestaValidacionCatalogo(input.error);
  try {
    return respuestaOkCatalogo(await cambiarVisibilidadWeb(id.data, input.data, session.userId));
  } catch (error) {
    return respuestaErrorCatalogo(error, "PATCH /api/ecommerce/catalogo/[producto_web_id]/visibilidad");
  }
});
