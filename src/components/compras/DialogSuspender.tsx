"use client";

/**
 * @component DialogSuspender
 * @description Suspensión manual de un Proveedor HOMOLOGADO (HU-H1, spec
 * §2.2): transición a `SUSPENDIDO` con `motivo` OBLIGATORIO. La suspensión
 * bloquea la selección del proveedor en nuevas órdenes de compra pero NO
 * afecta OC `CONFIRMADA` en curso (validación en la capa de servicios, nunca
 * a nivel de BD — spec §2.2).
 *
 * Exige el motivo en el propio modal antes de habilitar el botón (primera
 * barrera); el schema Zod server-side (`CambiarEstadoProveedorSchema`,
 * refine de SUSPENDIDO) es la segunda.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, AlertTriangle } from "lucide-react";

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

interface DialogSuspenderProps {
  proveedorId: string;
  razonSocial: string;
}

export function DialogSuspender({ proveedorId, razonSocial }: DialogSuspenderProps) {
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
      const resultado = await cambiarEstadoProveedor(proveedorId, {
        nuevo_estado: "SUSPENDIDO",
        motivo: motivo.trim(),
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
        variant="outline"
        size="sm"
        className="gap-1.5 text-red-700 border-red-200 bg-red-50 hover:bg-red-100"
        onClick={() => setOpen(true)}
      >
        <Ban className="size-3.5" aria-hidden="true" />
        Suspender
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Suspender a {razonSocial}
          </AlertDialogTitle>
          <AlertDialogDescription>
            El proveedor pasa a estado <strong>SUSPENDIDO</strong>: deja de ser
            seleccionable en nuevas órdenes de compra. Las órdenes{" "}
            <strong>CONFIRMADA</strong> en curso no se ven afectadas.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`motivo-suspension-${proveedorId}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Motivo de la suspensión
          </label>
          <textarea
            id={`motivo-suspension-${proveedorId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Incumplimiento reiterado de plazos de entrega."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede suspender sin un motivo.
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
                Suspendiendo…
              </>
            ) : (
              <>
                <Ban className="size-4" aria-hidden="true" />
                Confirmar suspensión
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}