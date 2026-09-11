"use client";

/**
 * @component EditarProductoMaestroDialog
 * @description HU-A8 (ajuste "botón por fila") — punto de entrada de la
 * edición de `ProductoMaestro`, ahora como botón "Editar" al lado de CADA
 * producto en `ListadoProductos.tsx` (ya no hay un único botón arriba de la
 * lista). Como la fila ya conoce el `producto_maestro_id`, el flujo se
 * saltea el paso de búsqueda (`BuscadorProductoExistente` sigue existiendo
 * y sigue usándose en otros lugares, como el wizard de alta de HU-A1, pero
 * no acá) y va directo a:
 *
 *  1. Cargar — `obtenerProductoMaestroParaEdicion(productoId)` al abrir el
 *     Dialog (el `useEffect` corre por cada montaje; Base UI desmonta el
 *     `Popup` al cerrar, mismo comportamiento ya documentado en
 *     `TablaProveedores.tsx`, así que reabrir siempre vuelve a pedir datos
 *     frescos en vez de mostrar un estado viejo).
 *  2. Editar — `FormularioEditarProductoMaestro` precargado con ese detalle.
 *
 * `FormularioEditarProductoMaestro` todavía expone un botón "Elegir otro"
 * (prop `onCambiarProducto`, no se tocó ese componente) — acá no tiene
 * sentido volver a un buscador que ya no está montado, así que ese botón
 * simplemente cierra el Dialog; el usuario elige otra fila desde la tabla.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";

import { FormularioEditarProductoMaestro } from "@/components/inventario/FormularioEditarProductoMaestro";
import {
  obtenerProductoMaestroParaEdicion,
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
  productoId: string;
  onExito: () => void;
  onCancelar: () => void;
}

function FlujoEdicionProductoMaestro({
  productoId,
  onExito,
  onCancelar,
}: FlujoEdicionProductoMaestroProps) {
  const [productoDetalle, setProductoDetalle] = useState<ProductoMaestroCreado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    obtenerProductoMaestroParaEdicion(productoId).then((resultado) => {
      if (cancelado) return;
      setCargando(false);

      if (resultado.error) {
        setErrorCarga(resultado.error.message);
        return;
      }

      setProductoDetalle(resultado.data);
    });

    return () => {
      cancelado = true;
    };
  }, [productoId]);

  if (productoDetalle) {
    return (
      <FormularioEditarProductoMaestro
        producto={productoDetalle}
        onExito={onExito}
        onCambiarProducto={onCancelar}
      />
    );
  }

  return (
    <div className="space-y-3">
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

interface EditarProductoMaestroDialogProps {
  productoId: string;
}

export function EditarProductoMaestroDialog({ productoId }: EditarProductoMaestroDialogProps) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <Button
        id={`btn-editar-producto-${productoId}`}
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
        onClick={() => setAbierto(true)}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        Editar
      </Button>

      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Producto Maestro</DialogTitle>
          <DialogDescription>
            Editá los atributos comerciales y logísticos de este producto.
          </DialogDescription>
        </DialogHeader>

        <FlujoEdicionProductoMaestro
          productoId={productoId}
          onExito={() => {
            setAbierto(false);
            router.refresh();
          }}
          onCancelar={() => setAbierto(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
