"use client";

/**
 * @component DialogEnviarOrdenCompra
 * @description Emisión de una Orden de Compra al proveedor (HU-H3, spec §2.5;
 * Alcance Funcional §2.1). Transición BORRADOR → ENVIADA.
 *
 * "Comprador Solicita / Supervisor Emite" (Alcance §5): esta acción es
 * **exclusiva del rol Supervisor de Compras** (`ordenes_compra:enviar`). El
 * RSC de detalle solo renderiza este componente cuando el usuario tiene ese
 * permiso y la orden está en BORRADOR — un Comprador no ve el botón. El
 * endpoint revalida el permiso igual (defensa en profundidad).
 *
 * Al emitir, la orden queda notificada al proveedor y bloqueada para edición
 * de ítems y cantidades. No pide datos extra (a diferencia de CONFIRMAR /
 * CANCELAR).
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertTriangle } from "lucide-react";

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

interface DialogEnviarOrdenCompraProps {
  ordenCompraId: string;
  numeroOrden: string;
}

export function DialogEnviarOrdenCompra({
  ordenCompraId,
  numeroOrden,
}: DialogEnviarOrdenCompraProps) {
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
        accion: "ENVIAR",
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
        className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        onClick={() => setOpen(true)}
      >
        <Send className="size-4" aria-hidden="true" />
        Enviar orden
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Send className="size-4 text-blue-600" aria-hidden="true" />
            Emitir la orden {numeroOrden} al proveedor
          </AlertDialogTitle>
          <AlertDialogDescription>
            La orden pasa a estado ENVIADA: queda notificada al proveedor y
            bloqueada para edición de ítems y cantidades. Esta acción la ejecuta
            el Supervisor de Compras.
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
                Enviando…
              </>
            ) : (
              <>
                <Send className="size-4" aria-hidden="true" />
                Confirmar envío
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
