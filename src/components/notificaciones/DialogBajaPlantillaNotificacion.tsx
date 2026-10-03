"use client";

/**
 * @component DialogBajaPlantillaNotificacion
 * @description Baja lógica de una PlantillaNotificacion (HU-F2, task §4.3 ·
 * RULES.md Regla N.° 1) con `deletion_reason` OBLIGATORIO — mismo patrón que
 * `DialogAnularComprobante` (HU-H9). A diferencia de aquel, la baja es
 * reversible: la plantilla se puede reactivar (task §4.1-bis).
 *
 * El motivo se exige en el propio modal antes de habilitar el botón (primera
 * barrera); `DarDeBajaPlantillaNotificacionSchema` server-side es la segunda.
 * Tras el éxito: `router.refresh()` ANTES de cerrar y toast (task §6).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";

import { darDeBajaPlantillaNotificacionAction } from "@/app/(dashboard)/administracion/notificaciones/actions";
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

interface DialogBajaPlantillaNotificacionProps {
  open: boolean;
  onClose: () => void;
  plantilla: PlantillaNotificacionListado | undefined;
}

export function DialogBajaPlantillaNotificacion({
  open,
  onClose,
  plantilla,
}: DialogBajaPlantillaNotificacionProps) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const motivoValido = motivo.trim().length > 0;

  const handleConfirm = () => {
    if (!plantilla) return;
    setServerError(null);
    startTransition(async () => {
      const resultado = await darDeBajaPlantillaNotificacionAction(plantilla.id, {
        deletion_reason: motivo.trim(),
      });
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      router.refresh();
      onClose();
      toast.add({
        title: "Plantilla dada de baja",
        description: `${resultado.data.tipo_evento} — los próximos eventos usarán el texto por defecto.`,
        type: "success",
      });
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Dar de baja la plantilla
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs">{plantilla?.tipo_evento}</span>
            <br />
            Es una <strong>baja lógica</strong>: la plantilla se conserva y se puede
            reactivar. Mientras esté dada de baja, este evento se notifica con el
            texto por defecto del sistema.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="motivo-baja-plantilla"
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Motivo de la baja
          </label>
          <textarea
            id="motivo-baja-plantilla"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={isPending}
            placeholder="Ej: La redacción quedó desactualizada; se usará el texto por defecto."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede dar de baja sin un motivo.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={onClose}>
            Volver
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={!motivoValido || isPending}
            onClick={handleConfirm}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Ban className="size-4" aria-hidden="true" />
            )}
            {isPending ? "Dando de baja…" : "Confirmar baja"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
