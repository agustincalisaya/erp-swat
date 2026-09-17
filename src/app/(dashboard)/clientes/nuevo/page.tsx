/**
 * @page NuevoClientePage
 * @route /clientes/nuevo
 * @description HU-C1 — pantalla de alta de Cliente. Server Component
 * simple: no hay datos que precargar (es una pantalla de creación, no un
 * listado), delega todo el flujo interactivo a `FormularioAltaCliente`.
 * Mismo patrón de rutas que `/inventario/productos/nuevo`.
 */
import { UserPlus } from "lucide-react";
import { FormularioAltaCliente } from "@/components/clientes/FormularioAltaCliente";

export const metadata = {
  title: "Nuevo Cliente — ERP SWAT",
  description: "Alta de Cliente con validación de unicidad por DNI.",
};

export default function NuevoClientePage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <UserPlus className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Nuevo Cliente
          </h1>
        </div>

        <FormularioAltaCliente />
      </div>
    </main>
  );
}
