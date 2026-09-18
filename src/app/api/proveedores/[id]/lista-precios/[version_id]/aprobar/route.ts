/**
 * @module route — PATCH /api/proveedores/[id]/lista-precios/[version_id]/aprobar
 * @description HU-H2 (Módulo H) — Aprobación de una `ListaPrecioVersion` que
 * quedó pendiente por superar el umbral crítico de variación
 * (`docs/tasks/sdd/HU-H2/spec.md`, "Endpoint de aprobación"). Wrapper fino
 * (mismo patrón que `PATCH /api/ordenes-compra/[id]/estado/route.ts`):
 * resuelve sesión + permiso granular EXCLUSIVO
 * `proveedores:publicar_lista_critica`, valida el path param `version_id`
 * con Zod, delega en `aprobarListaPrecioVersion()` y mapea el
 * resultado/excepción. NINGUNA regla de negocio vive acá.
 *
 * Sin body — `aprobada_por_id` sale SIEMPRE de `session.userId` (spec.md:
 * "El usuario que aprueba se obtiene de la sesión autenticada, no del
 * payload"), nunca del path ni de un body.
 *
 * El `id` del path (proveedor) es solo forma de la URL (spec.md lo incluye
 * en el path, pero `aprobarListaPrecioVersion` no recibe `proveedor_id` como
 * parámetro — lo resuelve internamente desde la relación de la versión). Se
 * desestructura y se ignora deliberadamente: spec.md no exige validar que
 * corresponda al `proveedor_id` real de la versión, así que no se inventa
 * esa validación cruzada.
 *
 * Respuestas: 200 OK · 400 VALIDATION_ERROR / VERSION_YA_APROBADA ·
 * 401 UNAUTHORIZED · 403 FORBIDDEN · 404 VERSION_INEXISTENTE ·
 * 500 INTERNAL_ERROR.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withPermission } from "@/lib/auth/with-permission";
import { ListaPrecioVersionIdSchema } from "@/lib/schemas/lista-precios.schema";
import {
  aprobarListaPrecioVersion,
  PERMISO_APROBAR_LISTA_PRECIO_CRITICA,
} from "@/lib/services/proveedores/lista-precios.service";
import { ServiceError } from "@/lib/errors/service-error";

type Context = { params: Promise<{ id: string; version_id: string }> };

const STATUS_POR_CODIGO: Record<string, number> = {
  VERSION_INEXISTENTE: 404,
  VERSION_YA_APROBADA: 400,
};

export const PATCH = withPermission(
  PERMISO_APROBAR_LISTA_PRECIO_CRITICA,
  async (_req: NextRequest, session, context) => {
    // `id` (proveedor) solo decora la URL — no se usa (ver nota del módulo).
    const { version_id } = await (context as Context).params;
    const parsedVersionId = ListaPrecioVersionIdSchema.safeParse(version_id);
    if (!parsedVersionId.success) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message:
              parsedVersionId.error.issues[0]?.message ?? "ID de versión inválido",
          },
        },
        { status: 400 },
      );
    }

    try {
      const resultado = await aprobarListaPrecioVersion(
        parsedVersionId.data,
        session.userId,
      );
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError) {
        return NextResponse.json(
          { data: null, error: { code: err.code, message: err.message } },
          { status: STATUS_POR_CODIGO[err.code] ?? 400 },
        );
      }
      console.error(
        "[PATCH /api/proveedores/[id]/lista-precios/[version_id]/aprobar] Error inesperado:",
        err,
      );
      return NextResponse.json(
        { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } },
        { status: 500 },
      );
    }
  },
);
