/**
 * @module route — GET /api/proveedores/costo-reposicion/[variante_sku_id]
 * @description HU-H8 (Módulo H) — Costo de reposición vigente de una
 * VarianteSKU (spec_modulo_H.md §2.11). Endpoint de integración
 * servicio-a-servicio (actor "Sistema", consumido por Módulo B —todavía no
 * existe— y por Módulo D intra-proceso). Wrapper fino: resuelve sesión +
 * permiso granular `proveedores:leer_costo_reposicion` (vía `withPermission`,
 * único mecanismo real de auth/permisos del proyecto), valida el path param
 * con Zod, delega en `obtenerCostoReposicionVigente()` y mapea el
 * resultado/excepción al shape `{ data, error }`. NINGUNA regla de negocio
 * vive acá.
 *
 * Sin exports de no-cache (`dynamic`/`revalidate`/`fetchCache`): en esta
 * versión de Next (16.3.4) los Route Handlers NO cachean por defecto
 * (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`,
 * "Route Handlers are not cached by default" — esos exports existen para
 * OPTAR POR cachear un GET, no para lo contrario). Ningún route.ts hermano
 * de este módulo (H1/H2/H6/H7) los usa tampoco.
 *
 * Códigos 400/500: `VALIDATION_ERROR`/`INTERNAL_ERROR` — el código real y
 * dominante del proyecto (`proveedores/[id]/route.ts` [H1],
 * `[id]/lista-precios/route.ts` [H2], `auditoria/route.ts` [H6, con
 * justificación explícita en su propio comentario],
 * `auditoria/verificar-cadena/route.ts` [D.3]), NO
 * `VALIDACION_RUTA_INVALIDA`/`INTERNAL_SERVER_ERROR` como asumía la Spec
 * original copiando el patrón de `comparativa-precios/route.ts` [H7] — ese
 * archivo es la única excepción real del módulo (`VALIDACION_QUERY_INVALIDA`/
 * `ERROR_INTERNO`), no se replica ese outlier acá.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
 * 403 FORBIDDEN · 404 SIN_COSTO_REPOSICION_DISPONIBLE · 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { CostoReposicionParamsSchema } from "@/lib/schemas/costo-reposicion.schema";
import { obtenerCostoReposicionVigente } from "@/lib/services/proveedores/costo-reposicion.service";

type Context = { params: Promise<{ variante_sku_id: string }> };

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export const GET = withPermission(
  "proveedores:leer_costo_reposicion",
  async (_req: NextRequest, _session, context) => {
    const { variante_sku_id } = await (context as Context).params;
    const parsed = CostoReposicionParamsSchema.safeParse({ variante_sku_id });

    if (!parsed.success) {
      return errorJson(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Parámetro de ruta inválido",
        400,
      );
    }

    try {
      const resultado = await obtenerCostoReposicionVigente(parsed.data.variante_sku_id);

      if (!resultado) {
        return errorJson(
          "SIN_COSTO_REPOSICION_DISPONIBLE",
          "No hay costo de reposición vigente para esta variante",
          404,
        );
      }

      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      console.error(
        "[GET /api/proveedores/costo-reposicion/[variante_sku_id]] Error inesperado:",
        err,
      );
      return errorJson("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  },
);
