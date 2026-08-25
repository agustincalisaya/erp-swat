"use client";

/**
 * @component ModalJustificacionBaja
 * @description HU-A6 — AlertDialog de confirmación de baja lógica de una
 * `VarianteSKU` (Base UI). El textarea de justificación es OBLIGATORIO solo
 * cuando la variante tiene stock remanente activo (`stockTotal > 0`); con
 * stock cero la confirmación es directa. La UI es la primera barrera (R3);
 * el service re-valida en servidor (defensa en profundidad).
 *
 * Paleta azul Tailwind (`blue-*`) — requisito de la HU-A6 (R3, criterio 12).
 */
import { useState, useTransition, useCallback } from "react";
import { PackageX, Loader2, AlertTriangle } from "lucide-react";

import { darDeBajaVarianteAction } from "@/app/(dashboard)/inventario/variantes/actions";
import type { VarianteDadaDeBaja } from "@/lib/services/inventario/variante.service";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTrigger,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ModalJustificacionBajaProps {
  varianteId: string;
  sku: string;
  stockTotal: number;
  onSuccess?: (data: VarianteDadaDeBaja) => void;
}

export function ModalJustificacionBaja({
  varianteId,
  sku,
  stockTotal,
  onSuccess,
}: ModalJustificacionBajaProps) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const motivoRequerido = stockTotal > 0;

  const handleClose = useCallback(() => {
    setOpen(false);
    setMotivo("");
    setServerError(null);
  }, []);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const result = await darDeBajaVarianteAction({
        variante_id: varianteId,
        // Con stock 0 no se envía motivo (baja silenciosa); con stock > 0 el
        // textarea obligatorio ya fue validado del lado del cliente.
        deletion_reason: motivoRequerido ? motivo : undefined,
      });
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
        return;
      }
      handleClose();
      onSuccess?.(result.data!);
    });
  };

  const motivoValido = motivo.trim().length > 0;
  const confirmacionHabilitada = motivoRequerido ? motivoValido : true;

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <AlertDialogTrigger
        render={
          <Button
            id={`btn-baja-variante-${varianteId}`}
            variant="outline"
            size="sm"
            className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
          />
        }
      >
        <PackageX className="size-3.5" />
        Dar de baja
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-blue-700">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Dar de baja a la variante {sku}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {motivoRequerido
              ? "La variante tiene stock remanente: el motivo de baja es obligatorio. Los registros de stock y movimientos se conservan para trazabilidad."
              : "La variante no tiene stock remanente: la baja se ejecuta de forma directa. Los registros históricos se conservan para trazabilidad."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {motivoRequerido && (
          <div className="space-y-1.5">
            <label
              htmlFor={`motivo-baja-${varianteId}`}
              className="text-xs font-semibold uppercase tracking-wide text-gray-700"
            >
              Motivo de la baja
            </label>
            <textarea
              id={`motivo-baja-${varianteId}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: descontinuado con stock a liquidar"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/30"
            />
            <p className="text-xs text-muted-foreground">
              Campo obligatorio — no se puede confirmar la baja sin un motivo.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            variant="default"
            disabled={!confirmacionHabilitada || isPending}
            onClick={handleConfirm}
            className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Dando de baja…
              </>
            ) : (
              <>
                <PackageX className="size-4" aria-hidden="true" />
                Confirmar baja
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}