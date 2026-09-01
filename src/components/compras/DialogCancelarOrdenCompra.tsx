"use client";

/**
 * @component DialogCancelarOrdenCompra
 * @description Confirmación de cancelación de una Orden de Compra (HU-H3,
 * spec §2.5). La cancelación es **baja lógica** — nunca un DELETE: el
 * servicio marca `is_active=false` + `deleted_*` + `estado=CANCELADA` y la
 * fila queda consultable para la trazabilidad de la negociación.
 *
 * Exige `deletion_reason` en el propio modal antes de habilitar el botón
 * (primera barrera); el schema Zod server-side (`CambiarEstadoOrdenCompra
 * Schema`, rama CANCELAR) es la segunda. Solo debe renderizarse cuando la
 * orden está en BORRADOR o ENVIADA y el usuario tiene `ordenes_compra:cancelar`
 * — ambas condiciones las evalúa el RSC de detalle.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, AlertTriangle } from "lucide-react";

import { cambiarEstadoOrdenCompraAction } from "@/app/(dashboard)/compras/ordenes/actions";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DialogCancelarOrdenCompraProps {
  ordenCompraId: string;
  numeroOrden: string;
}

export function DialogCancelarOrdenCompra({
  ordenCompraId,
  numeroOrden,
}: DialogCancelarOrdenCompraProps) {
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
      const resultado = await cambiarEstadoOrdenCompraAction(ordenCompraId, {
        accion: "CANCELAR",
        deletion_reason: motivo.trim(),
      });
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      handleClose();
      router.refresh();
    });
  };

  const motivoValido = motivo.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <Button
        type="button"
        variant="destructive"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <Ban className="size-4" aria-hidden="true" />
        Cancelar orden
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Cancelar la orden {numeroOrden}
          </AlertDialogTitle>
          <AlertDialogDescription>
            La orden pasa a estado CANCELADA por baja lógica. Los ítems y el
            historial se conservan para trazabilidad — no puede deshacerse desde
            acá.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`motivo-cancelacion-${ordenCompraId}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Motivo de la cancelación
          </label>
          <textarea
            id={`motivo-cancelacion-${ordenCompraId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: El proveedor no puede cumplir el plazo — se reasigna a otro."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede confirmar la cancelación sin un motivo.
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
                Cancelando…
              </>
            ) : (
              <>
                <Ban className="size-4" aria-hidden="true" />
                Confirmar cancelación
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
