"use client";

/**
 * @component DialogReactivarPlantillaNotificacion
 * @description Reactivación de una PlantillaNotificacion dada de baja
 * (HU-F2, task §4.1-bis). Confirmación sin motivo (no es una baja), mismo
 * patrón de AlertDialog que `DialogAnularComprobante` (HU-H9). Reactivar no
 * cambia la redacción: se recupera la que tenía antes de la baja.
 * Tras el éxito: `router.refresh()` ANTES de cerrar y toast (task §6).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";

import { reactivarPlantillaNotificacionAction } from "@/app/(dashboard)/administracion/notificaciones/actions";
import type { PlantillaNotificacionListado } from "@/lib/services/notificaciones/plantilla-notificacion.service";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

interface DialogReactivarPlantillaNotificacionProps {
  open: boolean;
  onClose: () => void;
  plantilla: PlantillaNotificacionListado | undefined;
}

export function DialogReactivarPlantillaNotificacion({
  open,
  onClose,
  plantilla,
}: DialogReactivarPlantillaNotificacionProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    if (!plantilla) return;
    setServerError(null);
    startTransition(async () => {
      const resultado = await reactivarPlantillaNotificacionAction(plantilla.id);
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      router.refresh();
      onClose();
      toast.add({
        title: "Plantilla reactivada",
        description: `${resultado.data.tipo_evento} — vuelve a usarse en los próximos eventos.`,
        type: "success",
      });
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-4" aria-hidden="true" />
            Reactivar plantilla
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs">{plantilla?.tipo_evento}</span>
            <br />
            La plantilla vuelve a usarse con la redacción que tenía antes de la baja.
            Si necesitás cambiarla, editala después de reactivarla.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {plantilla?.deletion_reason && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold">Motivo de la baja:</span> {plantilla.deletion_reason}
          </p>
        )}

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={onClose}>
            Volver
          </AlertDialogCancel>
          <Button type="button" disabled={isPending} onClick={handleConfirm} className="gap-2">
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            {isPending ? "Reactivando…" : "Confirmar reactivación"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
