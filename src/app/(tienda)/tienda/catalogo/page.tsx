/**
 * @page CatalogoTienda
 * @route /tienda/catalogo
 * @description HU-E1 (CA1/CA2/CA3) — catálogo público. Server Component: lee
 * el servicio en cada request (sin cache), así un artículo agotado en el
 * mostrador se ve agotado en la próxima carga. Sin sesión (CA6).
 * HU-E11 (criterio 3) — búsqueda, filtros por categoría/talle/color/género/
 * modelo, orden por novedad o precio y paginación, todo por query params (un
 * formulario GET, sin JavaScript); los valores de los filtros vienen del
 * servicio (`filtros`, D11).
 */
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatearPrecio } from "@/components/tienda/formato";
import { ServiceError } from "@/lib/errors/service-error";
import { ListarCatalogoQuerySchema, type OrdenCatalogo } from "@/lib/schemas/ecommerce.schema";
import { listarCatalogo, type CatalogoPaginado, type FiltrosDisponibles } from "@/lib/services/ecommerce/catalogo-web.service";

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

const CLASE_SELECT = "w-full rounded-md border bg-white px-3 py-2 text-sm";

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

  // Filtros activos, para conservarlos al paginar.
  const activos = Object.fromEntries(
    (["q", "categoria", "talle", "color", "genero", "modelo"] as const)
      .filter((clave) => filtros[clave])
      .map((clave) => [clave, filtros[clave] as string]),
  );
  const conPagina = (page: number) => ({
    pathname: "/tienda/catalogo",
    query: { ...activos, ...(filtros.orden !== "novedad" ? { orden: filtros.orden } : {}), page },
  });
  const hayFiltros = Object.keys(activos).length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Catálogo</h1>
        <p className="text-sm text-slate-600">Stock disponible para retiro en Sucursal Salta.</p>
      </div>

      <form action="/tienda/catalogo" className="space-y-3 rounded-lg border p-3" aria-label="Buscar y filtrar">
        <div className="flex gap-2">
          <Input name="q" defaultValue={filtros.q ?? ""} placeholder="Buscar productos" aria-label="Buscar productos" />
          <Button type="submit">Buscar</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          {CAMPOS_FILTRO.map(([clave, etiqueta, opciones]) => (
            <label key={clave} className="space-y-1 text-xs text-slate-600">
              <span>{etiqueta}</span>
              <select name={clave} defaultValue={filtros[clave] ?? ""} className={CLASE_SELECT}>
                <option value="">Todos</option>
                {(catalogo?.filtros[opciones] ?? []).map((valor) => (
                  <option key={valor} value={valor}>
                    {valor}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="space-y-1 text-xs text-slate-600">
            <span>Ordenar por</span>
            <select name="orden" defaultValue={filtros.orden} className={CLASE_SELECT}>
              {(Object.keys(ETIQUETA_ORDEN) as OrdenCatalogo[]).map((orden) => (
                <option key={orden} value={orden}>
                  {ETIQUETA_ORDEN[orden]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-3 text-sm">
          <Button type="submit" variant="outline">
            Aplicar filtros
          </Button>
          {(hayFiltros || filtros.orden !== "novedad") && (
            <Link href="/tienda/catalogo" className="self-center text-slate-600 hover:underline">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {catalogo && catalogo.items.length === 0 && (
        <p className="rounded-lg border p-6 text-center text-sm text-slate-600">
          {hayFiltros
            ? "No encontramos productos con esos filtros. Probá con otros o limpiá la búsqueda."
            : "Todavía no hay productos publicados."}
        </p>
      )}

      {catalogo && catalogo.items.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {catalogo.items.map((producto) => (
            <li key={producto.producto_web_id}>
              <Link href={`/tienda/catalogo/${producto.producto_web_id}`} className="block h-full">
                <Card className="h-full overflow-hidden transition hover:shadow-md">
                  {producto.foto_url && (
                    <Image
                      src={producto.foto_url}
                      alt={producto.titulo}
                      width={400}
                      height={400}
                      unoptimized
                      className="aspect-square w-full object-cover"
                    />
                  )}
                  <CardContent className="space-y-1 pt-3">
                    <p className="line-clamp-2 text-sm font-medium">{producto.titulo}</p>
                    {producto.precio_desde !== null ? (
                      <p className="text-sm">desde {formatearPrecio(producto.precio_desde)}</p>
                    ) : (
                      <p className="text-sm text-slate-500">Sin precio disponible</p>
                    )}
                    {!producto.comprable ? (
                      <Badge variant="secondary">No disponible para la compra</Badge>
                    ) : producto.agotado ? (
                      <Badge variant="destructive">Agotado</Badge>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {catalogo && catalogo.paginacion.total_paginas > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Paginación">
          {filtros.page > 1 && <Link href={conPagina(filtros.page - 1)}>Anterior</Link>}
          <span>
            Página {catalogo.paginacion.pagina_actual} de {catalogo.paginacion.total_paginas}
          </span>
          {filtros.page < catalogo.paginacion.total_paginas && <Link href={conPagina(filtros.page + 1)}>Siguiente</Link>}
        </nav>
      )}
    </div>
  );
}
