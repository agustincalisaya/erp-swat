/**
 * HU-E11 — PATCH: una foto del contenido web (spec_modulo_E.md §2.11;
 * task_relos.md D6, D7). Exactamente una operación: `{ es_principal: true }`
 * o `{ deletion_reason }` (baja lógica, motivo obligatorio). Sin DELETE: el
 * archivo físico no se borra.
 *
 * Respuestas `{ data, error }`: 200 · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 PRODUCTO_WEB_NO_ENCONTRADO | FOTO_WEB_NO_ENCONTRADA ·
 * 500 INTERNAL_ERROR.
 */
import type { NextRequest } from "next/server";
import { PERMISO_GESTIONAR_CATALOGO } from "@/lib/auth/permisos-ecommerce";
import { withPermission } from "@/lib/auth/with-permission";
import { ActualizarFotoWebSchema, FotoWebIdSchema } from "@/lib/schemas/ecommerce.schema";
import { darDeBajaFoto, marcarFotoPrincipal } from "@/lib/services/ecommerce/foto-web.service";
import {
  leerJsonCatalogo,
  parsearProductoWebId,
  respuestaErrorCatalogo,
  respuestaOkCatalogo,
  respuestaValidacionCatalogo,
} from "@/lib/services/ecommerce/respuesta-catalogo";

type Contexto = { params: Promise<{ producto_web_id: string; foto_id: string }> };

export const PATCH = withPermission(PERMISO_GESTIONAR_CATALOGO, async (req: NextRequest, session, context) => {
  const params = await (context as Contexto).params;
  const id = parsearProductoWebId(params.producto_web_id);
  if (!id.success) return respuestaValidacionCatalogo(id.error);
  const fotoId = FotoWebIdSchema.safeParse(params.foto_id);
  if (!fotoId.success) return respuestaValidacionCatalogo(fotoId.error);
  const input = ActualizarFotoWebSchema.safeParse(await leerJsonCatalogo(req));
  if (!input.success) return respuestaValidacionCatalogo(input.error);
  try {
    const data =
      input.data.deletion_reason !== undefined
        ? await darDeBajaFoto(id.data, fotoId.data, input.data.deletion_reason, session.userId)
        : await marcarFotoPrincipal(id.data, fotoId.data, session.userId);
    return respuestaOkCatalogo(data);
  } catch (error) {
    return respuestaErrorCatalogo(error, "PATCH /api/ecommerce/catalogo/[producto_web_id]/fotos/[foto_id]");
  }
});
