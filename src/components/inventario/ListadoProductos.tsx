"use client";

/**
 * @component ListadoProductos
 * @description Tabla de Productos Maestro activos de `/inventario/productos`
 * con buscador por nombre (case-insensitive, filtra en cliente sobre la
 * lista ya cargada por el Server Component — sin roundtrip por tecla).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, PackagePlus } from "lucide-react";

import type { ProductoMaestroListado } from "@/lib/services/inventario/producto.service";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { EditarProductoMaestroDialog } from "@/components/inventario/EditarProductoMaestroDialog";

interface ListadoProductosProps {
  productos: ProductoMaestroListado[];
  /** HU-A8 — resuelto server-side (`usuarioPuedeEditarProductoMaestro()`), mismo patrón que `puedeBajar` en `variantes/page.tsx`. */
  puedeEditar: boolean;
}

export function ListadoProductos({ productos, puedeEditar }: ListadoProductosProps) {
  const [query, setQuery] = useState("");

  const productosFiltrados = useMemo(() => {
    const texto = query.trim().toLowerCase();
    if (!texto) return productos;
    return productos.filter((p) => p.nombre.toLowerCase().includes(texto));
  }, [productos, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre…"
            autoComplete="off"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {puedeEditar && <EditarProductoMaestroDialog />}

          <Link
            href="/inventario/productos/nuevo"
            className={buttonVariants() + " gap-2 shrink-0 bg-blue-600 hover:bg-blue-700 text-white"}
          >
            <PackagePlus className="size-4" aria-hidden="true" />
            Nuevo Producto Maestro
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-blue-50 text-xs uppercase tracking-wide text-blue-900">
            <tr>
              <th className="px-4 py-3 font-semibold">Cod Producto</th>
              <th className="px-4 py-3 font-semibold">Nombre</th>
              <th className="px-4 py-3 font-semibold">Rubro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {productosFiltrados.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  {productos.length === 0
                    ? "No hay productos maestro activos."
                    : `Ningún producto activo coincide con "${query.trim()}".`}
                </td>
              </tr>
            ) : (
              productosFiltrados.map((producto) => (
                <tr key={producto.id} className="hover:bg-blue-50/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {producto.codigo_producto}
                  </td>
                  <td className="px-4 py-3 text-gray-900">{producto.nombre}</td>
                  <td className="px-4 py-3 text-gray-700">{producto.rubro}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
