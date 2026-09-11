"use client";

/**
 * @component EditarVarianteDialog
 * @description HU-A8 (ajuste "botón por fila") — calcado 1:1 de
 * `EditarProductoMaestroDialog.tsx`: ahora es el botón "Editar" de CADA fila
 * en `variantes/page.tsx` (ya no hay un único botón arriba de la lista), y
 * como la fila ya conoce el `variante_id` el flujo se saltea
 * `BuscadorVarianteExistente` y va directo a:
 *
 *  1. Cargar — `obtenerVarianteParaEdicionAction(varianteId)` al abrir el
 *     Dialog (`ActionResult<T>` — el check es `!resultado.success`, no
 *     `resultado.error`, a diferencia del flujo de Producto Maestro).
 *  2. Editar — `FormularioEditarVariante` precargado con ese detalle.
 *
 * El botón "Elegir otro" de `FormularioEditarVariante` (prop
 * `onCambiarVariante`, no se tocó ese componente) cierra el Dialog en vez de
 * volver a un buscador que ya no está montado acá.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";

import { FormularioEditarVariante } from "@/components/inventario/FormularioEditarVariante";
import { obtenerVarianteParaEdicionAction } from "@/app/(dashboard)/inventario/variantes/actions";
import type { VarianteParaEdicion } from "@/lib/services/inventario/variante.service";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FlujoEdicionVarianteProps {
  varianteId: string;
  onExito: () => void;
  onCancelar: () => void;
}

function FlujoEdicionVariante({ varianteId, onExito, onCancelar }: FlujoEdicionVarianteProps) {
  const [varianteDetalle, setVarianteDetalle] = useState<VarianteParaEdicion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    obtenerVarianteParaEdicionAction(varianteId).then((resultado) => {
      if (cancelado) return;
      setCargando(false);

      if (!resultado.success) {
        setErrorCarga(resultado.error?.message ?? "Error desconocido.");
        return;
      }

      setVarianteDetalle(resultado.data ?? null);
    });

    return () => {
      cancelado = true;
    };
  }, [varianteId]);

  if (varianteDetalle) {
    return (
      <FormularioEditarVariante
        variante={varianteDetalle}
        onExito={onExito}
        onCambiarVariante={onCancelar}
      />
    );
  }

  return (
    <div className="space-y-3">
      {cargando && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Cargando datos de la variante…
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

interface EditarVarianteDialogProps {
  varianteId: string;
}

export function EditarVarianteDialog({ varianteId }: EditarVarianteDialogProps) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <Button
        id={`btn-editar-variante-${varianteId}`}
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
          <DialogTitle>Editar Variante</DialogTitle>
          <DialogDescription>Editá el EAN-13 y proveedor de esta variante.</DialogDescription>
        </DialogHeader>

        <FlujoEdicionVariante
          varianteId={varianteId}
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
