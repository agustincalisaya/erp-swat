"use client";

/**
 * @component DialogVolverPendiente
 * @description Transición de un Proveedor a `PENDIENTE` desde `HOMOLOGADO` o
 * `SUSPENDIDO` (HU-H1, spec §2.2 — matriz: H→P y S→P). El proveedor deja de
 * estar homologado / suspendido y queda a la espera de una nueva homologación
 * para volver a ser seleccionable en órdenes de compra. Sin motivo: solo la
 * suspensión lo exige (`CambiarEstadoProveedorSchema`).
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2 } from "lucide-react";

import { cambiarEstadoProveedor } from "@/app/(dashboard)/compras/proveedores/actions";
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

interface DialogVolverPendienteProps {
  proveedorId: string;
  razonSocial: string;
  /** Estado actual (para el mensaje de contexto). */
  estadoActual: "HOMOLOGADO" | "SUSPENDIDO";
  /** Modo controlado: el padre maneja el estado de apertura (AccionesProveedorMenu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Mensajes amigables por código de error (fallback: mensaje del server). */
const ERROR_POR_CODIGO: Record<string, string> = {
  TRANSICION_INVALIDA:
    "Este proveedor ya no admite el cambio a PENDIENTE. Recargá la lista e intentá de nuevo.",
  PROVEEDOR_NO_ENCONTRADO:
    "El proveedor indicado no existe o fue dado de baja.",
};

export function DialogVolverPendiente({
  proveedorId,
  razonSocial,
  estadoActual,
  open,
  onOpenChange,
}: DialogVolverPendienteProps) {
  const router = useRouter();
  const [openInterno, setOpenInterno] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const esControlado = open !== undefined;

  const handleClose = useCallback(() => {
    if (esControlado) {
      onOpenChange?.(false);
    } else {
      setOpenInterno(false);
    }
    setServerError(null);
  }, [esControlado, onOpenChange]);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = await cambiarEstadoProveedor(proveedorId, {
        nuevo_estado: "PENDIENTE",
      });
      if (resultado.error) {
        setServerError(
          ERROR_POR_CODIGO[resultado.error.code] ?? resultado.error.message,
        );
        return;
      }
      handleClose();
      router.refresh();
    });
  };

  return (
    <AlertDialog
      open={esControlado ? open : openInterno}
      onOpenChange={(o) => {
        if (!o) {
          handleClose();
        } else if (!esControlado) {
          setOpenInterno(true);
        }
      }}
    >
      {!esControlado && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100"
          onClick={() => setOpenInterno(true)}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Volver a PENDIENTE
        </Button>
      )}

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-blue-700">
            <RotateCcw className="size-4" aria-hidden="true" />
            Volver a PENDIENTE — {razonSocial}
          </AlertDialogTitle>
          <AlertDialogDescription>
            El proveedor pasa a estado <strong>PENDIENTE</strong>:
            {estadoActual === "SUSPENDIDO"
              ? " deja de estar suspendido y queda a la espera de una nueva homologación."
              : " deja de ser seleccionable en nuevas órdenes de compra hasta que se lo homologue de nuevo."}
            {" "}El cambio queda registrado en la auditoría (Módulo D).
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
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
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Actualizando…
              </>
            ) : (
              <>
                <RotateCcw className="size-4" aria-hidden="true" />
                Confirmar cambio a PENDIENTE
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}