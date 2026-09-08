/**
 * @page ProductosPage
 * @route /inventario/productos
 * @description Listado de Productos Maestro activos (Cod Producto / Nombre /
 * Rubro) con buscador por nombre. El wizard de alta ("Nuevo Producto
 * Maestro") vive ahora en `/inventario/productos/nuevo` — esta pantalla es
 * el punto de entrada del módulo.
 *
 * Protección: Módulo A no tiene todavía RBAC granular para Productos, solo
 * verificación de sesión (ver docstring de `Sidebar.tsx` y de
 * `app/api/inventario/productos/route.ts`) — mismo criterio que
 * `inventario/movimientos/page.tsx` y `inventario/variantes/page.tsx`:
 * `getServerSession()` + `redirect("/login")` si no hay sesión.
 */
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import {
  listarProductosActivosParaListado,
  usuarioPuedeEditarProductoMaestro,
} from "@/lib/services/inventario/producto.service";
import { ListadoProductos } from "@/components/inventario/ListadoProductos";

export const metadata = {
  title: "Productos Maestro — ERP SWAT",
  description: "Catálogo de productos maestro registrados en el sistema.",
};

export default async function ProductosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const puedeEditar = await usuarioPuedeEditarProductoMaestro(session.userId);
  const productos = await listarProductosActivosParaListado();

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Package className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Productos Maestro
            </h1>
            <p className="text-sm text-muted-foreground">
              Catálogo de productos maestro registrados en el sistema.
            </p>
          </div>
        </div>

        <ListadoProductos productos={productos} puedeEditar={puedeEditar} />
      </div>
    </main>
  );
}
