"use client";

/**
 * @component SelectorProveedorListaPrecios
 * @description Selector de proveedor HOMOLOGADO de la pantalla "Lista de
 * Precios" (HU-H2/H6/H7). Estado en la URL vía `?proveedor=` (spec del
 * usuario: "via searchParams es fine") — reusa `ComboboxFiltrable` (mismo
 * componente que `FormularioNuevaOrdenCompra`), sin duplicar un selector
 * nuevo.
 */

import { useRouter } from "next/navigation";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { Label } from "@/components/ui/label";
import type { ProveedorParaSelector } from "@/lib/services/proveedores/orden-compra.service";

interface SelectorProveedorListaPreciosProps {
  proveedores: ProveedorParaSelector[];
  proveedorSeleccionadoId: string;
}

export function SelectorProveedorListaPrecios({
  proveedores,
  proveedorSeleccionadoId,
}: SelectorProveedorListaPreciosProps) {
  const router = useRouter();

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor="lista-precios-proveedor"
        className="text-xs font-semibold uppercase tracking-wide text-gray-700"
      >
        Proveedor
      </Label>
      <ComboboxFiltrable
        id="lista-precios-proveedor"
        items={proveedores}
        getId={(p) => p.id}
        getLabel={(p) =>
          p.nombre_fantasia ? `${p.razon_social} (${p.nombre_fantasia})` : p.razon_social
        }
        value={proveedorSeleccionadoId}
        onChange={(p) => router.push(`/compras/listas-precios?proveedor=${p.id}`)}
        placeholder="Buscar proveedor homologado…"
        emptyMessage="No hay proveedores homologados."
        pageSize={8}
      />
    </div>
  );
}
