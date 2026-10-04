/**
 * HU-E5 — PATCH: baja lógica del contenido web (criterio 3; task_relos.md D1).
 * `is_active = false`, `deleted_at`, `deleted_by`, `deletion_reason`
 * obligatorio y `visibilidad_web = false`. Una segunda baja da 404 (D3).
 *
 * Respuestas `{ data, error }`: 200 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PRODUCTO_WEB_NO_ENCONTRADO · 500 INTERNAL_ERROR.
 */
import type { NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { BajaContenidoWebSchema } from "@/lib/schemas/ecommerce.schema";
import {
  leerJsonCatalogo,
  parsearProductoWebId,
  respuestaErrorCatalogo,
  respuestaOkCatalogo,
  respuestaValidacionCatalogo,
} from "@/lib/services/ecommerce/respuesta-catalogo";
import { darDeBajaContenidoWeb } from "@/lib/services/ecommerce/visibilidad-web.service";

type Contexto = { params: Promise<{ producto_web_id: string }> };

export const PATCH = withPermission(PERMISO_GESTIONAR_CATALOGO, async (req: NextRequest, session, context) => {
  const id = parsearProductoWebId((await (context as Contexto).params).producto_web_id);
  if (!id.success) return respuestaValidacionCatalogo(id.error);
  const input = BajaContenidoWebSchema.safeParse(await leerJsonCatalogo(req));
  if (!input.success) return respuestaValidacionCatalogo(input.error);
  try {
    return respuestaOkCatalogo(await darDeBajaContenidoWeb(id.data, input.data, session.userId));
  } catch (error) {
    return respuestaErrorCatalogo(error, "PATCH /api/ecommerce/catalogo/[producto_web_id]/baja");
  }
});
