/**
 * HU-B9 — Lista de Precios de Venta (spec_modulo_B.md §2.9).
 *
 * MÍNIMO introducido por HU-E1 (aprobado por el owner): SOLO la función de
 * resolución server-side, con la firma exacta de spec B §2.9, y su versión por
 * lote (para el catálogo web, sin N+1). La publicación de versiones, la
 * sugerencia de precio, las rutas `/api/ventas/lista-precios/**` y la UI
 * siguen siendo alcance de HU-B9 — el owner de B9 completa ESTE archivo.
 *
 * Regla de vigencia (spec B §2.9): versión con `is_active = true` y
 * `vigente_desde <= now()`, la más reciente. Resolución POR VARIANTE: si la
 * versión más reciente no trae ítem para un SKU, se busca en la versión
 * anterior activa que sí lo traiga ("ni en ninguna versión anterior activa" —
 * mismo criterio que el fix A3 de `obtenerVersionVigente()` de Módulo H).
 * Una versión con `vigente_desde` futura NUNCA se aplica antes de tiempo.
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export interface PrecioVentaVigente {
  precio_venta: Prisma.Decimal;
  lista_precio_version_id: string;
}

/**
 * Precio de venta vigente de una variante, o `null` si no tiene ítem activo
 * en ninguna versión vigente. El llamador traduce `null` a su propio error
 * de negocio (ej. `SKU_SIN_PRECIO_VIGENTE`, `ARTICULO_NO_DISPONIBLE`).
 */
export async function resolverPrecioVentaVigente(
  variante_sku_id: string,
): Promise<PrecioVentaVigente | null> {
  const precios = await resolverPreciosVentaVigentes([variante_sku_id]);
  return precios.get(variante_sku_id) ?? null;
}

/**
 * Versión por lote de `resolverPrecioVentaVigente()`: una sola consulta para N
 * variantes. Las variantes sin precio vigente quedan fuera del `Map`.
 */
export async function resolverPreciosVentaVigentes(
  variante_sku_ids: readonly string[],
  ahora: Date = new Date(),
): Promise<Map<string, PrecioVentaVigente>> {
  const resultado = new Map<string, PrecioVentaVigente>();
  if (variante_sku_ids.length === 0) return resultado;

  const items = await prisma.listaPrecioVentaItem.findMany({
    where: {
      variante_sku_id: { in: [...new Set(variante_sku_ids)] },
      is_active: true,
      deleted_at: null,
      version: {
        is_active: true,
        deleted_at: null,
        vigente_desde: { lte: ahora },
        lista: { is_active: true, deleted_at: null },
      },
    },
    select: {
      variante_sku_id: true,
      precio_venta: true,
      version_id: true,
      version: { select: { vigente_desde: true, created_at: true } },
    },
    // Más reciente primero; `created_at` desempata dos versiones con el mismo
    // `vigente_desde`.
    orderBy: [{ version: { vigente_desde: "desc" } }, { version: { created_at: "desc" } }],
  });

  for (const item of items) {
    if (resultado.has(item.variante_sku_id)) continue;
    resultado.set(item.variante_sku_id, {
      precio_venta: item.precio_venta,
      lista_precio_version_id: item.version_id,
    });
  }
  return resultado;
}
