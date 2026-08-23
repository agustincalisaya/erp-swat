"use client";

/**
 * @component NuevaVariante
 * @description Mejora post-HU-A1 — camino independiente para agregar
 * variantes a un `ProductoMaestro` activo ya existente, separado del wizard
 * de alta de HU-A1 (`FormularioProductoMaestro.tsx`). Vive en su propia
 * ruta (`app/(dashboard)/inventario/productos/variantes/nueva/page.tsx`),
 * no como una rama condicional del flujo de alta.
 *
 * Estado mínimo: `productoSeleccionado` decide qué mostrar — el buscador o
 * la matriz. Sin `productoSeleccionado`, se busca con
 * `BuscadorProductoExistente` (reusado tal cual, sin tocar su lógica). Con
 * `productoSeleccionado`, se reusa `MatrizVariantes` tal cual — su propia
 * vista de resultado (SKUs generados + "Generar otra tanda de variantes")
 * queda intacta; "Buscar otro producto" vive afuera de `MatrizVariantes` y
 * solo resetea `productoSeleccionado` a `null` (sin navegar), igual que
 * "Cargar otro producto" en el wizard de alta.
 */
import { useState } from "react";
import { Search } from "lucide-react";

import { BuscadorProductoExistente } from "@/components/inventario/BuscadorProductoExistente";
import { MatrizVariantes } from "@/components/inventario/MatrizVariantes";
import type { ProductoMaestroActivoResumen } from "@/app/(dashboard)/inventario/productos/actions";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function NuevaVariante() {
  const [productoSeleccionado, setProductoSeleccionado] =
    useState<ProductoMaestroActivoResumen | null>(null);

  if (productoSeleccionado) {
    return (
      <div className="space-y-5">
        <MatrizVariantes
          productoMaestroId={productoSeleccionado.id}
          codigoProducto={productoSeleccionado.codigo_producto}
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
      <CardContent className="pt-6">
        <BuscadorProductoExistente onSeleccionar={setProductoSeleccionado} />
      </CardContent>
    </Card>
  );
}
