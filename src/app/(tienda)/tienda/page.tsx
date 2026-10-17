/** Portada editorial de la tienda. El catálogo sigue siendo una ruta propia. */
import type { Metadata } from "next";
import { formatearPrecio } from "@/components/tienda/formato";
import { ServiceError } from "@/lib/errors/service-error";
import { ListarCatalogoQuerySchema } from "@/lib/schemas/ecommerce.schema";
import { listarCatalogo } from "@/lib/services/ecommerce/catalogo-web.service";
import { ExperienciaTienda, type CategoriaDestacada, type ProductoDestacado } from "./ExperienciaTienda";

export const metadata: Metadata = {
  title: "SWAT Indumentarias | Inicio",
  description: "Indumentaria y equipamiento para el trabajo y el camino. Explorá la colección y retirá en Sucursal Salta.",
};

/** Un marcador de ejemplo no debe representar visualmente un producto real. */
function fotoAdministrada(foto: string | null): string | null {
  return foto && !/placehold\.co|placeholder|data:image\/svg/i.test(foto) ? foto : null;
}

export default async function TiendaInicioPage() {
  let destacados: ProductoDestacado[] = [];
  let categorias: CategoriaDestacada[] = [];
  let errorCatalogo = false;

  try {
    const catalogo = await listarCatalogo(ListarCatalogoQuerySchema.parse({ page_size: 48 }));
    const ordenados = [...catalogo.items].sort((a, b) =>
      Number(b.comprable && !b.agotado) - Number(a.comprable && !a.agotado),
    );
    destacados = ordenados.slice(0, 3).map((producto) => ({
      id: producto.producto_web_id,
      titulo: producto.titulo,
      categoria: producto.categoria,
      foto: fotoAdministrada(producto.foto_url),
      precio: producto.precio_desde !== null ? formatearPrecio(producto.precio_desde) : null,
      comprable: producto.comprable && !producto.agotado,
    }));
    categorias = catalogo.filtros.categorias.map((nombre) => {
      const producto = catalogo.items.find((item) => item.categoria === nombre && fotoAdministrada(item.foto_url));
      return {
        nombre,
        foto: producto ? fotoAdministrada(producto.foto_url) : null,
      };
    });
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    errorCatalogo = true;
  }

  return <ExperienciaTienda destacados={destacados} categorias={categorias} errorCatalogo={errorCatalogo} />;
}
