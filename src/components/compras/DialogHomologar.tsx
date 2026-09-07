"use client";

/**
 * @component DialogHomologar
 * @description Homologación manual de un Proveedor (HU-H1, spec §2.2):
 * transición a `HOMOLOGADO` desde `PENDIENTE` (alta) o desde `SUSPENDIDO`
 * (re-homologación). Solo debe renderizarse cuando el estado lo permite y el
 * usuario tiene `proveedores:homologar` — ambas condiciones las evalúa el
 * RSC padre. Sin motivo: la homologación no lo exige (solo la suspensión).
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2 } from "lucide-react";

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

interface DialogHomologarProps {
  proveedorId: string;
  razonSocial: string;
  /** Estado actual (para el mensaje de contexto). */
  estadoActual: "PENDIENTE" | "SUSPENDIDO";
}

export function DialogHomologar({
  proveedorId,
  razonSocial,
  estadoActual,
}: DialogHomologarProps) {
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
      const resultado = await cambiarEstadoProveedor(proveedorId, {
        nuevo_estado: "HOMOLOGADO",
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
        size="sm"
        className="gap-1.5 text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100"
        onClick={() => setOpen(true)}
      >
        <BadgeCheck className="size-3.5" aria-hidden="true" />
        Homologar
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-blue-700">
            <BadgeCheck className="size-4" aria-hidden="true" />
            Homologar a {razonSocial}
          </AlertDialogTitle>
          <AlertDialogDescription>
            El proveedor pasa a estado <strong>HOMOLOGADO</strong>
            {estadoActual === "SUSPENDIDO"
              ? " (re-homologación): vuelve a ser seleccionable para nuevas órdenes de compra."
              : ": queda seleccionable para nuevas órdenes de compra."}
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
                Homologando…
              </>
            ) : (
              <>
                <BadgeCheck className="size-4" aria-hidden="true" />
                Confirmar homologación
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}