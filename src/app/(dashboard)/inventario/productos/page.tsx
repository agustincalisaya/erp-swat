/**
 * @page ProductosPage
 * @route /inventario/productos
 * @description HU-A1 — Sección 8: pantalla de alta de Producto Maestro +
 * generación de la matriz de Variantes SKU. Server Component simple: no hay
 * datos que precargar (es una pantalla de creación, no un listado), así que
 * delega todo el flujo interactivo a `FormularioProductoMaestro`.
 */
import { Package } from "lucide-react";
import { FormularioProductoMaestro } from "@/components/inventario/FormularioProductoMaestro";

export const metadata = {
  title: "Nuevo Producto Maestro — ERP SWAT",
  description: "Alta de Producto Maestro y generación en lote de Variantes SKU.",
};

export default function ProductosPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Package className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Nuevo Producto Maestro
            </h1>
            <p className="text-sm text-muted-foreground">
              Alta del producto y generación de la matriz de variantes (talle × color × género).
            </p>
          </div>
        </div>

        <FormularioProductoMaestro />
      </div>
    </main>
  );
}
