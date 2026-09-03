"use client";

/**
 * @component EditarVarianteDialog
 * @description HU-A8 — punto de entrada de la edición de `VarianteSKU`
 * desde `/inventario/variantes`: botón "Editar" al lado de "Agregar
 * variante" (task_HU-A8.md §8), calcado 1:1 de `EditarProductoMaestroDialog.tsx`
 * (mismo `Dialog`, mismo estado de 3 pasos montado solo dentro de
 * `DialogContent`, mismo `router.refresh()` al cerrar con éxito):
 *
 *  1. Buscar — `BuscadorVarianteExistente` reusado tal cual.
 *  2. Cargar — `obtenerVarianteParaEdicionAction()` trae el detalle completo
 *     por id (`ActionResult<T>` — el check es `!resultado.success`, no
 *     `resultado.error`, a diferencia del flujo de Producto Maestro).
 *  3. Editar — `FormularioEditarVariante` precargado con ese detalle.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";

import { BuscadorVarianteExistente } from "@/components/inventario/BuscadorVarianteExistente";
import { FormularioEditarVariante } from "@/components/inventario/FormularioEditarVariante";
import { obtenerVarianteParaEdicionAction } from "@/app/(dashboard)/inventario/variantes/actions";
import type {
  VarianteActivaResumen,
  VarianteParaEdicion,
} from "@/lib/services/inventario/variante.service";

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
  onExito: () => void;
}

function FlujoEdicionVariante({ onExito }: FlujoEdicionVarianteProps) {
  const [varianteDetalle, setVarianteDetalle] = useState<VarianteParaEdicion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  async function handleSeleccionar(variante: VarianteActivaResumen) {
    setErrorCarga(null);
    setCargando(true);
    const resultado = await obtenerVarianteParaEdicionAction(variante.id);
    setCargando(false);

    if (!resultado.success) {
      setErrorCarga(resultado.error?.message ?? "Error desconocido.");
      return;
    }

    setVarianteDetalle(resultado.data ?? null);
  }

  if (varianteDetalle) {
    return (
      <FormularioEditarVariante
        variante={varianteDetalle}
        onExito={onExito}
        onCambiarVariante={() => setVarianteDetalle(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <BuscadorVarianteExistente onSeleccionar={handleSeleccionar} />

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

export function EditarVarianteDialog() {
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
          <DialogTitle>Editar Variante</DialogTitle>
          <DialogDescription>
            Buscá una variante activa para editar su EAN-13 y proveedor.
          </DialogDescription>
        </DialogHeader>

        <FlujoEdicionVariante
          onExito={() => {
            setAbierto(false);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
