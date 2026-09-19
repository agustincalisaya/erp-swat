/**
 * @module route — GET /api/proveedores/comparativa-precios
 * @description HU-H7 (Módulo H) — Vista comparativa de precios entre
 * proveedores (`docs/specs/spec_modulo_H.md` §2.10,
 * `docs/tasks/sdd/HU-H7/spec_HU-H7_FINAL.md`). Wrapper fino: resuelve sesión +
 * permiso granular `proveedores:comparar_precios` (vía `withPermission`,
 * único mecanismo real de auth/permisos del proyecto — mismo patrón que
 * `src/app/api/proveedores/route.ts` y `.../auditoria/route.ts`), valida los
 * query params con Zod, delega en `obtenerComparativaPrecios()` y mapea el
 * resultado/excepción al shape `{ data, error }`. NINGUNA regla de negocio
 * vive acá.
 *
 * Respuestas: 200 OK · 400 VALIDACION_QUERY_INVALIDA · 401 (infraestructura
 * de auth, fuera de las 5 respuestas canónicas de esta HU) · 403 (ver nota
 * de discrepancia abajo) · 422 SIN_PROVEEDORES_COMPARABLES · 500 ERROR_INTERNO.
 *
 * ⚠️ Discrepancia Spec-vs-código real, reportada explícitamente (no
 * corregida en silencio): la Spec/Tasks documentan el 403 como
 * `{ code: "SIN_PERMISO", message: "No autorizado para comparar precios
 * entre proveedores" }`. `withPermission` — el único mecanismo real de
 * permisos del proyecto (`src/lib/auth/with-permission.ts`), sin ningún
 * parámetro para personalizar code/message por ruta — devuelve siempre
 * `{ code: "FORBIDDEN", message: "No tenés el permiso requerido para
 * realizar esta acción" }`. Mismo comportamiento real que ya tienen TODOS
 * los route.ts hermanos de `proveedores/` (`route.ts`, `auditoria/route.ts`,
 * `[id]/lista-precios/route.ts`) — ninguno personaliza el 403. Se usa
 * `withPermission` tal cual, sin envolverlo ni reinventar el mecanismo
 * (instrucción explícita del usuario): el 403 real de este endpoint es
 * `FORBIDDEN`, no `SIN_PERMISO`.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { withPermission } from "@/lib/auth/with-permission";
import { obtenerComparativaPrecios } from "@/lib/services/proveedores/comparativa-precios.service";
import { ServiceError } from "@/lib/errors/service-error";

// ──────────────────────────────────────────────────────────────────────────────
// T13 — ComparativaPreciosQuerySchema (Spec §1.2, exacto — no modificado)
// ──────────────────────────────────────────────────────────────────────────────

export const ComparativaPreciosQuerySchema = z
  .object({
    variante_sku_id: z.string().uuid().optional(),
    categoria: z.string().min(1).optional(),
  })
  .refine((d) => d.variante_sku_id !== undefined || d.categoria !== undefined, {
    message: "Debe indicarse variante_sku_id o categoria",
    path: ["variante_sku_id"],
  })
  .refine((d) => !(d.variante_sku_id !== undefined && d.categoria !== undefined), {
    message: "Los criterios variante_sku_id y categoria son mutuamente excluyentes",
    path: ["categoria"],
  });

// ──────────────────────────────────────────────────────────────────────────────
// Auxiliar de respuesta de error — mismo patrón real que
// `src/app/api/proveedores/route.ts` (`errorJson` + `STATUS_POR_CODIGO`).
// ──────────────────────────────────────────────────────────────────────────────

const STATUS_POR_CODIGO: Record<string, number> = {
  SIN_PROVEEDORES_COMPARABLES: 422,
};

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

// ──────────────────────────────────────────────────────────────────────────────
// T14 — GET /api/proveedores/comparativa-precios
// ──────────────────────────────────────────────────────────────────────────────

export const GET = withPermission(
  "proveedores:comparar_precios",
  async (req: NextRequest): Promise<NextResponse> => {
    const { searchParams } = new URL(req.url);
    const parsed = ComparativaPreciosQuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!parsed.success) {
      return errorJson(
        "VALIDACION_QUERY_INVALIDA",
        parsed.error.issues[0]?.message ?? "Query inválida",
        400,
      );
    }

    try {
      const resultado = await obtenerComparativaPrecios(parsed.data);
      return NextResponse.json({ data: resultado, error: null }, { status: 200 });
    } catch (err) {
      if (err instanceof ServiceError && err.code === "SIN_PROVEEDORES_COMPARABLES") {
        return errorJson(err.code, err.message, STATUS_POR_CODIGO[err.code]);
      }

      // `DUPLICADO_LISTA_PRECIO_ITEM` (guarda de corrupción de datos, T6) y
      // cualquier otra excepción inesperada comparten el mismo tratamiento:
      // 500 genérico sin exponer el detalle real al cliente. El detalle
      // completo queda logueado acá para diagnóstico interno.
      console.error("[GET /api/proveedores/comparativa-precios] Error inesperado:", err);
      return errorJson("ERROR_INTERNO", "Error interno del servidor", 500);
    }
  },
);
