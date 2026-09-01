"use client";

/**
 * @component DialogCerrarOrdenCompra
 * @description Cierre definitivo de una Orden de Compra (HU-H3, spec §2.5;
 * Alcance §2.1). Transición RECIBIDA_COMPLETA → CERRADA (baja lógica: la
 * orden se conserva consultable como respaldo comercial/contable).
 *
 * El RSC de detalle solo renderiza este componente cuando la orden está en
 * RECIBIDA_COMPLETA y el usuario tiene `ordenes_compra:cerrar`. El endpoint
 * revalida el permiso igual.
 *
 * NOTA: hoy ningún flujo produce el estado RECIBIDA_COMPLETA — lo genera
 * HU-H4 (recepción física, Emir), todavía sin integrar. Este botón queda
 * construido pero no es ejercitable end-to-end en la UI hasta esa
 * integración.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, AlertTriangle } from "lucide-react";

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

interface DialogCerrarOrdenCompraProps {
  ordenCompraId: string;
  numeroOrden: string;
}

export function DialogCerrarOrdenCompra({
  ordenCompraId,
  numeroOrden,
}: DialogCerrarOrdenCompraProps) {
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
      const resultado = await cambiarEstadoOrdenCompraAction(ordenCompraId, {
        accion: "CERRAR",
      });
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
        variant="outline"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <Archive className="size-4" aria-hidden="true" />
        Cerrar orden
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Archive className="size-4 text-emerald-600" aria-hidden="true" />
            Cerrar la orden {numeroOrden}
          </AlertDialogTitle>
          <AlertDialogDescription>
            La orden se concilió contra la factura del proveedor y pasa a estado
            CERRADA. El cierre no elimina la orden: se conserva consultable como
            respaldo de la operación comercial y contable.
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
            className="gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Cerrando…
              </>
            ) : (
              <>
                <Archive className="size-4" aria-hidden="true" />
                Confirmar cierre
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
