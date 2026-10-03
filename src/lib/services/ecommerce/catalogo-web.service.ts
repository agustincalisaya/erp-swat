/**
 * HU-E1 — Catálogo online con disponibilidad en tiempo real (spec_modulo_E.md §2.1).
 *
 * Sin copia propia de nada (CA1): stock de Módulo A
 * (`obtenerStockDisponiblePorVariantes`, depósito del canal web de
 * `ConfiguracionSistema`), precio de HU-B9 (`resolverPreciosVentaVigentes`),
 * talle/color/género de `VarianteSKU`, y de Módulo E solo título/descripción/
 * fotos/visibilidad (`ProductoWebContenido`). Sin cache: cada request lee el
 * estado actual (CA2).
 *
 * `resolverVariantesWeb()` es la ÚNICA vista "web" de una variante: la usan
 * el catálogo, el carrito y el checkout, con el mismo predicado
 * `evaluarComprabilidad()` (D6).
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import type { MotivoArticuloNoDisponible } from "@/lib/events/event-types";
import type { ListarCatalogoQuery } from "@/lib/schemas/ecommerce.schema";
import { evaluarComprabilidad } from "@/lib/services/ecommerce/comprabilidad";
import { obtenerStockDisponiblePorVariantes } from "@/lib/services/inventario/stock.service";
import { obtenerDepositoCanalWebId } from "@/lib/services/sistema/configuracion.service";
import { resolverPreciosVentaVigentes } from "@/lib/services/ventas/lista-precio-venta.service";

const NO_BORRADO = { is_active: true, deleted_at: null } as const;

/** Vista web de una variante: lo que necesitan catálogo, carrito y checkout. */
export interface VarianteWeb {
  variante_sku_id: string;
  sku: string;
  talle: string;
  color: string;
  genero: string;
  modelo: string;
  producto_web_id: string | null;
  titulo: string;
  foto_url: string | null;
  /** `null` = sin precio vigente (HU-B9). Number (no Decimal) para la UI/JSON. */
  precio_venta: number | null;
  /** Precio exacto para congelar en el pedido (checkout). */
  precio_venta_decimal: Prisma.Decimal | null;
  lista_precio_version_id: string | null;
  /** Disponible en el depósito del canal web (Módulo A), en tiempo real. */
  disponible: number;
  comprable: boolean;
  motivo: MotivoArticuloNoDisponible | null;
}

const selectVarianteWeb = {
  id: true,
  sku: true,
  talle: true,
  color: true,
  genero: true,
  modelo: true,
  is_active: true,
  deleted_at: true,
  producto_maestro: {
    select: {
      nombre: true,
      is_active: true,
      deleted_at: true,
      contenido_web: {
        select: {
          id: true,
          titulo_comercial: true,
          descripcion: true,
          visibilidad_web: true,
          is_active: true,
          deleted_at: true,
          fotos: {
            where: NO_BORRADO,
            select: { url: true, es_principal: true },
            orderBy: [{ es_principal: "desc" }, { orden: "asc" }],
          },
        },
      },
    },
  },
} satisfies Prisma.VarianteSKUSelect;

/**
 * Vista web de las variantes pedidas (incluidas las INACTIVAS: el carrito y el
 * checkout tienen que poder decir "este artículo fue discontinuado"). Las
 * variantes inexistentes no aparecen en el `Map`.
 *
 * @throws {ServiceError} CONFIGURACION_NO_ENCONTRADA | CANAL_WEB_NO_CONFIGURADO
 */
export async function resolverVariantesWeb(
  varianteSkuIds: readonly string[],
  depositoId?: string,
): Promise<Map<string, VarianteWeb>> {
  const ids = [...new Set(varianteSkuIds)];
  const resultado = new Map<string, VarianteWeb>();
  if (ids.length === 0) return resultado;

  const deposito = depositoId ?? (await obtenerDepositoCanalWebId());
  const [variantes, precios, stock] = await Promise.all([
    prisma.varianteSKU.findMany({ where: { id: { in: ids } }, select: selectVarianteWeb }),
    resolverPreciosVentaVigentes(ids),
    obtenerStockDisponiblePorVariantes(ids, deposito),
  ]);

  for (const v of variantes) {
    const contenido = v.producto_maestro.contenido_web;
    const precio = precios.get(v.id) ?? null;
    const evaluacion = evaluarComprabilidad({
      variante: v,
      producto: v.producto_maestro,
      contenido: contenido ? { ...contenido, fotos_activas: contenido.fotos.length } : null,
      precio_venta: precio ? precio.precio_venta.toNumber() : null,
    });
    resultado.set(v.id, {
      variante_sku_id: v.id,
      sku: v.sku,
      talle: v.talle,
      color: v.color,
      genero: v.genero,
      modelo: v.modelo,
      producto_web_id: contenido?.id ?? null,
      titulo: contenido?.titulo_comercial ?? v.producto_maestro.nombre,
      foto_url: contenido?.fotos[0]?.url ?? null,
      precio_venta: precio ? precio.precio_venta.toNumber() : null,
      precio_venta_decimal: precio?.precio_venta ?? null,
      lista_precio_version_id: precio?.lista_precio_version_id ?? null,
      disponible: stock.get(v.id) ?? 0,
      comprable: evaluacion.comprable,
      motivo: evaluacion.comprable ? null : evaluacion.motivo,
    });
  }
  return resultado;
}

// ──────────────────────────────────────────────────────────────────────────────
// Listado y detalle público
// ──────────────────────────────────────────────────────────────────────────────

export interface ProductoWebResumen {
  producto_web_id: string;
  titulo: string;
  categoria: string;
  foto_url: string | null;
  /** Menor precio entre las variantes comprables; `null` si ninguna lo es. */
  precio_desde: number | null;
  /** Hay al menos una variante comprable (precio vigente, etc.). */
  comprable: boolean;
  /** Ninguna variante comprable tiene stock en el depósito web (CA2). */
  agotado: boolean;
}

export interface ProductoWebDetalle extends Omit<ProductoWebResumen, "foto_url"> {
  descripcion: string;
  fotos: string[];
  variantes: VarianteWeb[];
}

/** Contenido publicable en la tienda: activo, visible, con Producto Maestro
 * activo y con foto (spec E §2.11). El precio se evalúa por variante. */
const whereContenidoPublicado = {
  ...NO_BORRADO,
  visibilidad_web: true,
  descripcion: { not: "" },
  producto_maestro: NO_BORRADO,
  fotos: { some: NO_BORRADO },
} satisfies Prisma.ProductoWebContenidoWhereInput;

function resumir(variantes: VarianteWeb[]) {
  const comprables = variantes.filter((v) => v.comprable);
  const precios = comprables.map((v) => v.precio_venta).filter((p): p is number => p !== null);
  return {
    precio_desde: precios.length > 0 ? Math.min(...precios) : null,
    comprable: comprables.length > 0,
    agotado: comprables.length > 0 && comprables.every((v) => v.disponible <= 0),
  };
}

export interface CatalogoPaginado {
  items: ProductoWebResumen[];
  paginacion: { total: number; pagina_actual: number; total_paginas: number; por_pagina: number };
}

export async function listarCatalogo(query: ListarCatalogoQuery): Promise<CatalogoPaginado> {
  const depositoId = await obtenerDepositoCanalWebId();
  const where: Prisma.ProductoWebContenidoWhereInput = {
    ...whereContenidoPublicado,
    ...(query.q
      ? {
          OR: [
            { titulo_comercial: { contains: query.q, mode: "insensitive" } },
            { descripcion: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(query.categoria ? { producto_maestro: { ...NO_BORRADO, categoria: query.categoria } } : {}),
  };

  const [total, contenidos] = await Promise.all([
    prisma.productoWebContenido.count({ where }),
    prisma.productoWebContenido.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        titulo_comercial: true,
        producto_maestro: {
          select: { categoria: true, variantes: { where: NO_BORRADO, select: { id: true } } },
        },
        fotos: { where: NO_BORRADO, select: { url: true }, orderBy: [{ es_principal: "desc" }, { orden: "asc" }], take: 1 },
      },
    }),
  ]);

  const vistas = await resolverVariantesWeb(
    contenidos.flatMap((c) => c.producto_maestro.variantes.map((v) => v.id)),
    depositoId,
  );

  return {
    items: contenidos.map((c) => ({
      producto_web_id: c.id,
      titulo: c.titulo_comercial,
      categoria: c.producto_maestro.categoria,
      foto_url: c.fotos[0]?.url ?? null,
      ...resumir(c.producto_maestro.variantes.map((v) => vistas.get(v.id)!).filter(Boolean)),
    })),
    paginacion: {
      total,
      pagina_actual: query.page,
      total_paginas: Math.max(1, Math.ceil(total / query.page_size)),
      por_pagina: query.page_size,
    },
  };
}

/** @throws {ServiceError} PRODUCTO_WEB_NO_ENCONTRADO — inexistente o no publicado */
export async function obtenerDetalleProductoWeb(productoWebId: string): Promise<ProductoWebDetalle> {
  const contenido = await prisma.productoWebContenido.findFirst({
    where: { id: productoWebId, ...whereContenidoPublicado },
    select: {
      id: true,
      titulo_comercial: true,
      descripcion: true,
      fotos: { where: NO_BORRADO, select: { url: true }, orderBy: [{ es_principal: "desc" }, { orden: "asc" }] },
      producto_maestro: {
        select: { categoria: true, variantes: { where: NO_BORRADO, select: { id: true } } },
      },
    },
  });
  if (!contenido) {
    throw new ServiceError("PRODUCTO_WEB_NO_ENCONTRADO", "El producto no existe o no está publicado");
  }

  const vistas = await resolverVariantesWeb(contenido.producto_maestro.variantes.map((v) => v.id));
  const variantes = contenido.producto_maestro.variantes
    .map((v) => vistas.get(v.id))
    .filter((v): v is VarianteWeb => v !== undefined)
    .sort((a, b) => a.modelo.localeCompare(b.modelo) || a.color.localeCompare(b.color) || a.talle.localeCompare(b.talle));

  return {
    producto_web_id: contenido.id,
    titulo: contenido.titulo_comercial,
    categoria: contenido.producto_maestro.categoria,
    descripcion: contenido.descripcion,
    fotos: contenido.fotos.map((f) => f.url),
    variantes,
    ...resumir(variantes),
  };
}
