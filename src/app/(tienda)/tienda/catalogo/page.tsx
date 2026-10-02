/**
 * @page CatalogoTienda
 * @route /tienda/catalogo
 * @description HU-E1 (CA1/CA2/CA3) — catálogo público. Server Component: lee
 * el servicio en cada request (sin cache), así un artículo agotado en el
 * mostrador se ve agotado en la próxima carga. Sin sesión (CA6).
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
import { ListarCatalogoQuerySchema } from "@/lib/schemas/ecommerce.schema";
import { listarCatalogo, type CatalogoPaginado } from "@/lib/services/ecommerce/catalogo-web.service";

export default async function CatalogoTiendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = ListarCatalogoQuerySchema.safeParse({
    q: typeof params.q === "string" ? params.q : undefined,
    page: typeof params.page === "string" ? params.page : undefined,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Catálogo</h1>
          <p className="text-sm text-slate-600">Stock disponible para retiro en Sucursal Salta.</p>
        </div>
        <form className="flex gap-2" action="/tienda/catalogo">
          <Input name="q" defaultValue={filtros.q ?? ""} placeholder="Buscar productos" aria-label="Buscar productos" />
          <Button type="submit" variant="outline">Buscar</Button>
        </form>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {catalogo && catalogo.items.length === 0 && (
        <p className="text-sm text-slate-600">No encontramos productos para tu búsqueda.</p>
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
          {filtros.page > 1 && (
            <Link href={{ pathname: "/tienda/catalogo", query: { q: filtros.q, page: filtros.page - 1 } }}>Anterior</Link>
          )}
          <span>
            Página {catalogo.paginacion.pagina_actual} de {catalogo.paginacion.total_paginas}
          </span>
          {filtros.page < catalogo.paginacion.total_paginas && (
            <Link href={{ pathname: "/tienda/catalogo", query: { q: filtros.q, page: filtros.page + 1 } }}>Siguiente</Link>
          )}
        </nav>
      )}
    </div>
  );
}
