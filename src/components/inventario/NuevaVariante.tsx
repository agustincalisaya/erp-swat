"use client";

/**
 * @component NuevaVariante
 * @description Mejora post-HU-A1 — camino independiente para agregar
 * variantes a un `ProductoMaestro` activo ya existente, separado del wizard
 * de alta de HU-A1 (`FormularioProductoMaestro.tsx`). Vive en su propia
 * ruta (`app/(dashboard)/inventario/variantes/nueva/page.tsx`), no como una
 * rama condicional del flujo de alta.
 *
 * Estado mínimo: `productoSeleccionado` decide qué mostrar — el selector o
 * la matriz. Sin `productoSeleccionado`, se elige con un `ComboboxFiltrable`
 * sobre la lista completa de productos activos ya precargada por el Server
 * Component (filtrado en cliente, sin roundtrip por tecla — mismo componente
 * y criterio que el filtro "Producto Maestro" de `/inventario/variantes`).
 * Con `productoSeleccionado`, se reusa `MatrizVariantes` tal cual.
 *
 * `productoInicial` (prop) permite entrar directo a la Matriz sin pasar por
 * el selector — lo usa el atajo `?producto=<id>` desde la tabla de
 * `/inventario/productos`. "Buscar otro producto" resetea a `null` sin
 * navegar, igual que "Cargar otro producto" en el wizard de alta.
 */
import { useState } from "react";
import { Search } from "lucide-react";

import { MatrizVariantes } from "@/components/inventario/MatrizVariantes";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** Shape mínimo que necesita este flujo: id + código (para el SKU de la Matriz) + nombre (display). */
export interface ProductoParaNuevaVariante {
  id: string;
  codigo_producto: string;
  nombre: string;
}

interface NuevaVarianteProps {
  productos: ProductoParaNuevaVariante[];
  productoInicial?: ProductoParaNuevaVariante | null;
}

export function NuevaVariante({ productos, productoInicial = null }: NuevaVarianteProps) {
  const [productoSeleccionado, setProductoSeleccionado] =
    useState<ProductoParaNuevaVariante | null>(productoInicial);

  if (productoSeleccionado) {
    return (
      <div className="space-y-5">
        <MatrizVariantes
          productoMaestroId={productoSeleccionado.id}
          codigoProducto={productoSeleccionado.codigo_producto}
          nombreProducto={productoSeleccionado.nombre}
        />

        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => setProductoSeleccionado(null)}
        >
          <Search className="size-4" aria-hidden="true" />
          Buscar otro producto
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-2">
        <Label htmlFor="selector-producto-existente">¿El producto ya existe?</Label>
        <ComboboxFiltrable<ProductoParaNuevaVariante>
          id="selector-producto-existente"
          items={productos}
          getId={(producto) => producto.id}
          getLabel={(producto) => producto.nombre}
          value=""
          onChange={(producto) => setProductoSeleccionado(producto)}
          placeholder="Buscar y elegir un producto…"
          emptyMessage="No hay productos maestro activos."
        />
        <p className="text-xs text-muted-foreground">
          Elegí el producto al que querés agregarle variantes. Si todavía no
          existe, crealo desde{" "}
          <span className="font-medium text-foreground">Productos Maestro → Nuevo Producto Maestro</span>.
        </p>
      </CardContent>
    </Card>
  );
}
