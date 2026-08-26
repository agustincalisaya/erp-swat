/**
 * @page NuevaVariantePage
 * @route /inventario/productos/variantes/nueva
 * @description Mejora post-HU-A1: pantalla independiente para agregar
 * variantes a un `ProductoMaestro` activo ya existente — separada del
 * wizard de alta de HU-A1 (`/inventario/productos/nuevo`), no una rama
 * condicional de esa pantalla. Server Component simple, sin datos que
 * precargar (mismo criterio que `productos/nuevo/page.tsx`): delega todo el
 * flujo interactivo a `NuevaVariante`.
 */
import Link from "next/link";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { NuevaVariante } from "@/components/inventario/NuevaVariante";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "Nueva Variante — ERP SWAT",
  description: "Agregar una variante nueva a un Producto Maestro existente.",
};

export default function NuevaVariantePage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <LayoutGrid className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Nueva Variante</h1>
        </div>

        <NuevaVariante />

        <Link
          href="/inventario/productos/nuevo"
          className={buttonVariants({ variant: "ghost" }) + " gap-2"}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver a Productos
        </Link>
      </div>
    </main>
  );
}
