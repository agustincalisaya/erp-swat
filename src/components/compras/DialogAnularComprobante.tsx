"use client";

/**
 * @component DialogAnularComprobante
 * @description Anulación (baja lógica) de un ComprobanteProveedor (HU-H9,
 * spec_modulo_H.md §2.7 / §3.6 · RULES.md Regla N.° 1). Transición
 * `ACTIVO → ANULADO` con `deletion_reason` OBLIGATORIO. `ANULADO` es terminal:
 * el comprobante se conserva consultable, no se elimina ni se edita — toda
 * corrección es anular + registrar uno nuevo.
 *
 * El RSC de detalle de la OC solo renderiza este componente para comprobantes
 * `is_active` y usuarios con `comprobantes_proveedor:anular` (exclusivo
 * Supervisor de Compras). El endpoint revalida el permiso igual.
 *
 * Exige el motivo en el propio modal antes de habilitar el botón (primera
 * barrera); el schema Zod server-side (`AnularComprobanteProveedorSchema`) es
 * la segunda.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, AlertTriangle } from "lucide-react";

import { anularComprobanteProveedor } from "@/app/(dashboard)/compras/comprobantes/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";

interface DialogAnularComprobanteProps {
  comprobanteId: string;
  ordenCompraId: string;
  /** Etiqueta legible: "FACTURA_A N.° 0001-00012345". */
  descripcionComprobante: string;
}

export function DialogAnularComprobante({
  comprobanteId,
  ordenCompraId,
  descripcionComprobante,
}: DialogAnularComprobanteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setMotivo("");
    setServerError(null);
  }, []);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = await anularComprobanteProveedor(
        comprobanteId,
        { deletion_reason: motivo.trim() },
        ordenCompraId,
      );
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      handleClose();
      router.refresh();
      toast.add({
        title: "Comprobante anulado",
        description: `${descripcionComprobante} — baja lógica registrada.`,
        type: "success",
      });
    });
  };

  const motivoValido = motivo.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 text-red-700 border-red-200 bg-red-50 hover:bg-red-100"
        onClick={() => setOpen(true)}
      >
        <Ban className="size-3.5" aria-hidden="true" />
        Anular
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Anular comprobante {descripcionComprobante}
          </AlertDialogTitle>
          <AlertDialogDescription>
            La anulación es una <strong>baja lógica</strong>: el comprobante se
            conserva consultable pero deja de estar activo. No se puede editar un
            comprobante — si los datos son erróneos, anulá este y registrá uno
            nuevo. Esta acción no se puede revertir.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`motivo-anulacion-${comprobanteId}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Motivo de la anulación
          </label>
          <textarea
            id={`motivo-anulacion-${comprobanteId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Número de comprobante cargado con un dígito equivocado."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede anular sin un motivo.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
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
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Anulando…
              </>
            ) : (
              <>
                <Ban className="size-4" aria-hidden="true" />
                Confirmar anulación
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
