/** Enlaces de paginación del catálogo público; conserva los parámetros GET activos. */
export function enlacePaginaCatalogo(
  activos: Record<string, string>,
  orden: "novedad" | "precio_asc" | "precio_desc",
  page: number,
) {
  return {
    pathname: "/tienda/catalogo",
    query: { ...activos, ...(orden !== "novedad" ? { orden } : {}), page },
  };
}

/** El servicio conserva la página solicitada aun cuando no existan resultados allí. */
export function paginaCatalogoFueraDeRango(page: number, totalPaginas: number): boolean {
  return page > totalPaginas;
}
