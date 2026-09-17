"use client";

/**
 * @component DialogAceptarPresupuesto
 * @description Conversión de un Presupuesto EMITIDO en un PedidoVenta
 * RESERVADO (HU-B3, spec §2.3). Mismo patrón que
 * `DialogEnviarOrdenCompra.tsx`: `AlertDialog` de confirmación + Server
 * Action, sin datos adicionales a capturar.
 *
 * El RSC de detalle solo renderiza este componente cuando el presupuesto
 * está `EMITIDO` (y no vencido) y el usuario tiene `ventas:emitir_cotizacion`
 * — el endpoint revalida el permiso y la transición igual (defensa en
 * profundidad).
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

import { aceptarPresupuestoAction } from "@/app/(dashboard)/ventas/presupuestos/actions";
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

interface DialogAceptarPresupuestoProps {
  presupuestoId: string;
}

export function DialogAceptarPresupuesto({ presupuestoId }: DialogAceptarPresupuestoProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setServerError(null);
  }, []);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = await aceptarPresupuestoAction(presupuestoId);
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      handleClose();
      router.refresh();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <Button
        type="button"
        className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        onClick={() => setOpen(true)}
      >
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Aceptar y convertir a pedido
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-blue-600" aria-hidden="true" />
            Convertir el presupuesto en pedido de venta
          </AlertDialogTitle>
          <AlertDialogDescription>
            Se genera un Pedido de Venta en estado RESERVADO reutilizando la
            reserva de stock ya congelada — no se vuelve a descontar stock. El
            presupuesto queda vinculado como origen del pedido.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
            Volver
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={isPending}
            onClick={handleConfirm}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Convirtiendo…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Confirmar conversión
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
