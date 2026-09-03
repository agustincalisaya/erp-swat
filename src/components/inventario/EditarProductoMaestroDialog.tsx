"use client";

/**
 * @component EditarProductoMaestroDialog
 * @description HU-A8 — punto de entrada de la edición de `ProductoMaestro`
 * desde `/inventario/productos`: botón "Editar" al lado de "Nuevo Producto
 * Maestro" (task_HU-A8.md §8) que abre un `Dialog` (mismo componente que
 * `TablaProveedores.tsx`, no se introduce ningún modal nuevo) con tres
 * pasos internos, todos dentro de `FlujoEdicionProductoMaestro`:
 *
 *  1. Buscar — `BuscadorProductoExistente` reusado tal cual.
 *  2. Cargar — `obtenerProductoMaestroParaEdicion()` trae el detalle
 *     completo por id (no confundir con `buscarProductosActivos()`, que
 *     tiene `select` mínimo).
 *  3. Editar — `FormularioEditarProductoMaestro` precargado con ese detalle.
 *
 * El estado de los 3 pasos vive en `FlujoEdicionProductoMaestro`, montado
 * solo dentro de `DialogContent` — Base UI desmonta el `Popup` al cerrar
 * (mismo comportamiento ya documentado en `TablaProveedores.tsx`), así que
 * reabrir el diálogo siempre arranca en el paso 1 sin resetear nada a mano.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";

import { BuscadorProductoExistente } from "@/components/inventario/BuscadorProductoExistente";
import { FormularioEditarProductoMaestro } from "@/components/inventario/FormularioEditarProductoMaestro";
import {
  obtenerProductoMaestroParaEdicion,
  type ProductoMaestroActivoResumen,
  type ProductoMaestroCreado,
} from "@/app/(dashboard)/inventario/productos/actions";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FlujoEdicionProductoMaestroProps {
  onExito: () => void;
}

function FlujoEdicionProductoMaestro({ onExito }: FlujoEdicionProductoMaestroProps) {
  const [productoDetalle, setProductoDetalle] = useState<ProductoMaestroCreado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  async function handleSeleccionar(producto: ProductoMaestroActivoResumen) {
    setErrorCarga(null);
    setCargando(true);
    const resultado = await obtenerProductoMaestroParaEdicion(producto.id);
    setCargando(false);

    if (resultado.error) {
      setErrorCarga(resultado.error.message);
      return;
    }

    setProductoDetalle(resultado.data);
  }

  if (productoDetalle) {
    return (
      <FormularioEditarProductoMaestro
        producto={productoDetalle}
        onExito={onExito}
        onCambiarProducto={() => setProductoDetalle(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <BuscadorProductoExistente
        onSeleccionar={handleSeleccionar}
        label="Seleccione el Producto Maestro que desea editar"
      />

      {cargando && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Cargando datos del producto…
        </p>
      )}

      {errorCarga && (
        <Alert variant="destructive">
          <AlertDescription>{errorCarga}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function EditarProductoMaestroDialog() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <Button
        type="button"
        variant="outline"
        className="gap-2 shrink-0"
        onClick={() => setAbierto(true)}
      >
        <Pencil className="size-4" aria-hidden="true" />
        Editar
      </Button>

      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Producto Maestro</DialogTitle>
          <DialogDescription>
            Buscá un producto activo para editar sus atributos comerciales y logísticos.
          </DialogDescription>
        </DialogHeader>

        <FlujoEdicionProductoMaestro
          onExito={() => {
            setAbierto(false);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
