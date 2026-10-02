/**
 * @page TiendaInicio
 * @route /tienda
 * @description HU-E1 — la entrada de la tienda es el catálogo.
 */
import { redirect } from "next/navigation";

export default function TiendaInicioPage() {
  redirect("/tienda/catalogo");
}
