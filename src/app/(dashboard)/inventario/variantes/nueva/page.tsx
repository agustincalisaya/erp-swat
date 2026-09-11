/**
 * @page NuevaVariantePage
 * @route /inventario/variantes/nueva
 * @description Mejora post-HU-A1: pantalla independiente para agregar
 * variantes a un `ProductoMaestro` activo ya existente — separada del
 * wizard de alta de HU-A1 (`/inventario/productos/nuevo`), no una rama
 * condicional de esa pantalla.
 *
 * Server Component que precarga la lista de Productos Maestro activos para
 * el `ComboboxFiltrable` del paso "¿El producto ya existe?" (filtrado 100%
 * en cliente, sin roundtrip por tecla — mismo criterio que el filtro de
 * `/inventario/variantes`). Acepta `?producto=<id>` (atajo desde la tabla
 * de `/inventario/productos`): si el id matchea un producto activo, se
 * salta el paso de selección y se entra directo a la Matriz.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LayoutGrid } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { listarProductosActivosParaListado } from "@/lib/services/inventario/producto.service";
import { NuevaVariante } from "@/components/inventario/NuevaVariante";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "Nueva Variante — ERP SWAT",
  description: "Agregar una variante nueva a un Producto Maestro existente.",
};

interface NuevaVariantePageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NuevaVariantePage({ searchParams }: NuevaVariantePageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { producto } = await searchParams;
  const productoIdInicial = typeof producto === "string" ? producto : null;

  const productos = await listarProductosActivosParaListado();
  const productoInicial =
    productoIdInicial != null
      ? (productos.find((p) => p.id === productoIdInicial) ?? null)
      : null;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <LayoutGrid className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Nueva Variante</h1>
        </div>

        <NuevaVariante productos={productos} productoInicial={productoInicial} />

        <Link
          href="/inventario/variantes"
          className={buttonVariants({ variant: "ghost" }) + " gap-2"}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver a Variantes
        </Link>
      </div>
    </main>
  );
}
