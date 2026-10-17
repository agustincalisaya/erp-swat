/** Solo presenta fotografías administradas del producto; nunca sustituye artículos. */
export function fotoPublicaProducto(url: string | null | undefined): string | null {
  if (!url || /placehold\.co|placeholder|data:image\/svg/i.test(url)) return null;
  return url;
}
