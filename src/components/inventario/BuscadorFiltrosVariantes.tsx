"use client";

/**
 * @component BuscadorFiltrosVariantes
 * @description HU-A6 (R3, decisión D7) — barra de búsqueda general con
 * debounce 350 ms + filtro por Producto Maestro (`ComboboxFiltrable`, por
 * nombre, NUNCA por SKU) + "Limpiar filtros". Todo empuja estado a la URL
 * (`router.push`) y borra `page` para resetear a la página 1 al buscar o
 * filtrar (R2/R3). Ambos filtros se combinan y aplican sobre la pestaña
 * activa (el server los evalúa en `listarVariantesPaginadas`).
 *
 * Requiere estar envuelto en `<Suspense>` desde la página (useSearchParams).
 */
import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";

interface BuscadorFiltrosVariantesProps {
  /** Productos Maestro activos para el filtro (server-side, orden por nombre). */
  productos: { id: string; nombre: string }[];
  qInicial: string;
  productoMaestroIdInicial: string;
}

/** Sentinel "sin selección" del combo — mismo criterio que `TODOS_LOS_USUARIOS`
 *  de TablaForenseInventario: id vacío = sin filtro. */
const TODOS_LOS_PRODUCTOS = { id: "", nombre: "Todos los productos" };

export function BuscadorFiltrosVariantes({
  productos,
  qInicial,
  productoMaestroIdInicial,
}: BuscadorFiltrosVariantesProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(qInicial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aplicarFiltros = useCallback(
    (overrides: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(overrides).forEach(([key, valor]) => {
        if (valor && valor.trim()) {
          params.set(key, valor.trim());
        } else {
          params.delete(key);
        }
      });
      // R2/R3 — buscar o filtrar resetea la paginación a la página 1.
      params.delete("page");
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Debounce 350 ms (patrón TablaForenseInventario): el estado local
  // actualiza el input en cada tecla, la URL solo tras la pausa.
  const handleBusqueda = (valor: string) => {
    setQ(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      aplicarFiltros({ q: valor });
    }, 350);
  };

  const limpiarFiltros = () => {
    setQ("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    aplicarFiltros({ q: "", producto_maestro_id: "" });
  };

  const hayFiltrosActivos = q.trim() !== "" || productoMaestroIdInicial !== "";

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Búsqueda general */}
        <div className="space-y-1">
          <label
            htmlFor="busqueda-variantes"
            className="text-xs font-medium text-gray-700"
          >
            Buscar variante
          </label>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="busqueda-variantes"
              placeholder="SKU, talle, color, género, modelo…"
              value={q}
              onChange={(e) => handleBusqueda(e.target.value)}
              className="pl-8 text-sm h-9"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Filtro por Producto Maestro (por nombre, nunca por SKU) */}
        <div className="space-y-1">
          <label
            htmlFor="filtro-producto-maestro"
            className="text-xs font-medium text-gray-700"
          >
            Producto Maestro
          </label>
          <ComboboxFiltrable
            id="filtro-producto-maestro"
            items={[TODOS_LOS_PRODUCTOS, ...productos]}
            getId={(producto) => producto.id}
            getLabel={(producto) => producto.nombre}
            value={productoMaestroIdInicial}
            onChange={(producto) =>
              aplicarFiltros({ producto_maestro_id: producto.id })
            }
            placeholder="Todos los productos"
            emptyMessage="Sin productos."
          />
        </div>
      </div>

      {hayFiltrosActivos && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={limpiarFiltros}
            className="h-7 text-xs text-muted-foreground hover:text-blue-700"
          >
            Limpiar filtros
          </Button>
        </div>
      )}
    </div>
  );
}