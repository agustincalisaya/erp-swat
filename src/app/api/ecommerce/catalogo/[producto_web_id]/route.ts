/**
 * HU-E11 — PATCH: edición del título comercial y/o la descripción del
 * contenido web (spec_modulo_E.md §2.11; task_relos.md D5, D24). No toca
 * visibilidad, producto ni baja. Sin cambios reales: 200 sin UPDATE ni evento.
 *
 * Respuestas `{ data, error }`: 200 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PRODUCTO_WEB_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import type { NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { EditarContenidoWebSchema } from "@/lib/schemas/ecommerce.schema";
import { editarContenidoWeb } from "@/lib/services/ecommerce/contenido-web.service";
import {
  leerJsonCatalogo,
  parsearProductoWebId,
  respuestaErrorCatalogo,
  respuestaOkCatalogo,
  respuestaValidacionCatalogo,
} from "@/lib/services/ecommerce/respuesta-catalogo";

type Contexto = { params: Promise<{ producto_web_id: string }> };

export const PATCH = withPermission(PERMISO_GESTIONAR_CATALOGO, async (req: NextRequest, session, context) => {
  const id = parsearProductoWebId((await (context as Contexto).params).producto_web_id);
  if (!id.success) return respuestaValidacionCatalogo(id.error);
  const input = EditarContenidoWebSchema.safeParse(await leerJsonCatalogo(req));
  if (!input.success) return respuestaValidacionCatalogo(input.error);
  try {
    return respuestaOkCatalogo(await editarContenidoWeb(id.data, input.data, session.userId));
  } catch (error) {
    return respuestaErrorCatalogo(error, "PATCH /api/ecommerce/catalogo/[producto_web_id]");
  }
});
