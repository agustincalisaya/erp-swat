/**
 * @page CatalogoTienda
 * @route /tienda/catalogo
 * Storefront público: campaña editorial, búsqueda y catálogo con filtros GET.
 */
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowRight, ImageOff, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatearPrecio } from "@/components/tienda/formato";
import { fotoPublicaProducto } from "@/components/tienda/foto-publica";
import { enlacePaginaCatalogo, paginaCatalogoFueraDeRango } from "@/components/tienda/catalogo-navegacion";
import { TarjetaCatalogoMotion } from "@/components/tienda/TarjetaCatalogoMotion";
import { ServiceError } from "@/lib/errors/service-error";
import { ListarCatalogoQuerySchema, type OrdenCatalogo } from "@/lib/schemas/ecommerce.schema";
import { listarCatalogo, type CatalogoPaginado, type FiltrosDisponibles } from "@/lib/services/ecommerce/catalogo-web.service";
import styles from "./catalogo.module.css";

export const metadata: Metadata = {
  title: "Catálogo | SWAT Indumentarias",
  description: "Explorá la colección de indumentaria y calzado SWAT con stock actualizado para retiro en Salta.",
};

const CAMPOS_FILTRO = [
  ["categoria", "Categoría", "categorias"],
  ["talle", "Talle", "talles"],
  ["color", "Color", "colores"],
  ["genero", "Género", "generos"],
  ["modelo", "Modelo", "modelos"],
] as const satisfies readonly (readonly [string, string, keyof FiltrosDisponibles])[];

const ETIQUETA_ORDEN: Record<OrdenCatalogo, string> = {
  novedad: "Más nuevos",
  precio_asc: "Menor precio",
  precio_desc: "Mayor precio",
};

export default async function CatalogoTiendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const texto = (clave: string) => (typeof params[clave] === "string" ? params[clave] : undefined);
  const query = ListarCatalogoQuerySchema.safeParse({
    q: texto("q"),
    categoria: texto("categoria"),
    talle: texto("talle"),
    color: texto("color"),
    genero: texto("genero"),
    modelo: texto("modelo"),
    orden: texto("orden"),
    page: texto("page"),
  });
  const filtros = query.success ? query.data : ListarCatalogoQuerySchema.parse({});

  let catalogo: CatalogoPaginado | null = null;
  let error: string | null = null;
  try {
    catalogo = await listarCatalogo(filtros);
  } catch (err) {
    if (!(err instanceof ServiceError)) throw err;
    error = "La tienda no está disponible en este momento. Intentá de nuevo más tarde.";
  }

  const activos = Object.fromEntries(
    (["q", "categoria", "talle", "color", "genero", "modelo"] as const)
      .filter((clave) => filtros[clave])
      .map((clave) => [clave, filtros[clave] as string]),
  );
  const conPagina = (page: number) => enlacePaginaCatalogo(activos, filtros.orden, page);
  const hayFiltros = Object.keys(activos).length > 0;
  const cantidad = catalogo?.paginacion.total ?? 0;
  const filtrosSeleccionados = Object.keys(activos).filter((key) => key !== "q").length + (filtros.orden !== "novedad" ? 1 : 0);
  const paginaFueraDeRango = Boolean(catalogo && paginaCatalogoFueraDeRango(filtros.page, catalogo.paginacion.total_paginas));

  return (
    <div className={styles.storefront} data-tienda-wide lang="es-AR">
      <section id="catalogo" className={styles.catalogSection} aria-labelledby="catalog-title">
        <nav className={styles.breadcrumbs} aria-label="Ruta de navegación"><Link href="/tienda">Inicio</Link><span aria-hidden="true">/</span><span aria-current="page">Catálogo</span></nav>
        <div className={styles.catalogHeading}>
          <div>
            <p className={styles.sectionKicker}>SWAT / LA COLECCIÓN</p>
            <h1 id="catalog-title">El equipo para<br /><em>seguir adelante.</em></h1>
            <p className={styles.catalogSubhead}>Explorá los productos publicados y elegí la variante adecuada para vos.</p>
          </div>
          {!error && <span className={styles.resultCount}>{cantidad} {cantidad === 1 ? "producto" : "productos"}</span>}
        </div>

        <form action="/tienda/catalogo" className={styles.searchRow} aria-label="Buscar y filtrar">
          <div className={styles.searchBox}>
            <Search aria-hidden size={18} />
            <Input name="q" defaultValue={filtros.q ?? ""} placeholder="Buscar producto" aria-label="Buscar productos" type="search" />
            <Button type="submit" className={styles.searchButton}>Buscar</Button>
          </div>

          <details className={styles.filterDetails}>
            <summary><SlidersHorizontal aria-hidden size={17} /> Filtros y orden <span className={styles.filterCount}>{filtrosSeleccionados || ""}</span></summary>
            <div className={styles.filterPanel}>
              <div className={styles.filterGrid}>
                {CAMPOS_FILTRO.map(([clave, etiqueta, opciones]) => (
                  <label key={clave}>
                    <span>{etiqueta}</span>
                    <select name={clave} defaultValue={filtros[clave] ?? ""}>
                      <option value="">Todos</option>
                      {(catalogo?.filtros[opciones] ?? []).map((valor) => <option key={valor} value={valor}>{valor}</option>)}
                    </select>
                  </label>
                ))}
                <label>
                  <span>Ordenar por</span>
                  <select name="orden" defaultValue={filtros.orden}>
                    {(Object.keys(ETIQUETA_ORDEN) as OrdenCatalogo[]).map((orden) => <option key={orden} value={orden}>{ETIQUETA_ORDEN[orden]}</option>)}
                  </select>
                </label>
              </div>
              <div className={styles.filterActions}>
                <Button type="submit" variant="outline">Aplicar filtros</Button>
                {(hayFiltros || filtros.orden !== "novedad") && <Link href="/tienda/catalogo">Limpiar filtros</Link>}
              </div>
            </div>
          </details>
        </form>

        {error && <div role="alert" className={styles.statePanel}><p className={styles.stateEyebrow}>CATÁLOGO NO DISPONIBLE</p><h2>No pudimos cargar la colección.</h2><p>{error}</p><Link href="/tienda/catalogo">Volver a intentar <ArrowRight aria-hidden size={16} /></Link></div>}

        {catalogo && catalogo.items.length === 0 && (
          <div className={styles.statePanel} role="status"><p className={styles.stateEyebrow}>{paginaFueraDeRango ? "PÁGINA NO DISPONIBLE" : "SIN RESULTADOS"}</p><h2>{paginaFueraDeRango ? "Esta página ya no existe." : hayFiltros ? "No encontramos coincidencias." : "La colección está en preparación."}</h2><p>{paginaFueraDeRango ? "Volvé a la primera página para seguir explorando." : hayFiltros ? "Probá otra búsqueda o ajustá los filtros." : "Todavía no hay productos publicados en la tienda."}</p>{(hayFiltros || paginaFueraDeRango) && <Link href={paginaFueraDeRango ? conPagina(1) : "/tienda/catalogo"}>{paginaFueraDeRango ? "Ir a la primera página" : "Ver todo el catálogo"} <ArrowRight aria-hidden size={16} /></Link>}</div>
        )}

        {catalogo && catalogo.items.length > 0 && (
          <ul className={styles.productGrid}>
            {catalogo.items.map((producto) => {
              const foto = fotoPublicaProducto(producto.foto_url);
              return (
                <TarjetaCatalogoMotion key={producto.producto_web_id}>
                  <Link href={`/tienda/catalogo/${producto.producto_web_id}`} className={styles.productLink}>
                    <div className={styles.productPhoto}>
                      {foto ? <Image src={foto} alt={producto.titulo} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" unoptimized={!foto.startsWith("/")} /> : <span className={styles.photoFallback}><ImageOff aria-hidden size={27} /><span>Imagen no disponible</span></span>}
                      <span className={styles.quickView}>Ver producto <ArrowRight aria-hidden size={15} /></span>
                    </div>
                    <div className={styles.productInfo}>
                      <span className={styles.productCategory}>{producto.categoria}</span>
                      <h2>{producto.titulo}</h2>
                      {producto.precio_desde !== null ? <p className={styles.price}>Desde {formatearPrecio(producto.precio_desde)}</p> : <p className={styles.noPrice}>Precio no disponible</p>}
                      <span className={styles.availability}>{!producto.comprable ? "No disponible para compra online" : producto.agotado ? "Agotado" : "Disponible"}</span>
                    </div>
                  </Link>
                </TarjetaCatalogoMotion>
              );
            })}
          </ul>
        )}

        {catalogo && !paginaFueraDeRango && catalogo.paginacion.total_paginas > 1 && (
          <nav className={styles.pagination} aria-label="Paginación">
            {filtros.page > 1 ? <Link href={conPagina(filtros.page - 1)} rel="prev">Anterior</Link> : <span aria-disabled="true">Anterior</span>}
            <span aria-current="page">Página {catalogo.paginacion.pagina_actual} de {catalogo.paginacion.total_paginas}</span>
            {filtros.page < catalogo.paginacion.total_paginas ? <Link href={conPagina(filtros.page + 1)} rel="next">Siguiente</Link> : <span aria-disabled="true">Siguiente</span>}
          </nav>
        )}
      </section>
    </div>
  );
}
