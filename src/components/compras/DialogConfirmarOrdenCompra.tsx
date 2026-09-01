"use client";

/**
 * @component DialogConfirmarOrdenCompra
 * @description Confirmación de una Orden de Compra por parte del proveedor
 * (HU-H3, spec_modulo_H.md §2.5; Alcance §2.1). Transición ENVIADA →
 * CONFIRMADA.
 *
 * Captura `fecha_entrega_comprometida` (obligatoria) — el dato que el spec
 * exige para esta transición: "Se registra la fecha de entrega comprometida,
 * base del seguimiento de cumplimiento". El precio ya quedó congelado al
 * emitir; acá no se toca.
 *
 * El RSC de detalle solo renderiza este componente cuando la orden está en
 * ENVIADA y el usuario tiene `ordenes_compra:confirmar`. El endpoint revalida
 * el permiso igual (defensa en profundidad).
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2, AlertTriangle } from "lucide-react";

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

interface DialogConfirmarOrdenCompraProps {
  ordenCompraId: string;
  numeroOrden: string;
}

export function DialogConfirmarOrdenCompra({
  ordenCompraId,
  numeroOrden,
}: DialogConfirmarOrdenCompraProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setFecha("");
    setServerError(null);
  }, []);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = await cambiarEstadoOrdenCompraAction(ordenCompraId, {
        accion: "CONFIRMAR",
        fecha_entrega_comprometida: fecha,
      });
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      handleClose();
      router.refresh();
    });
  };

  const fechaValida = fecha.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <Button
        type="button"
        className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
        onClick={() => setOpen(true)}
      >
        <CalendarCheck className="size-4" aria-hidden="true" />
        Confirmar orden
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CalendarCheck className="size-4 text-indigo-600" aria-hidden="true" />
            Confirmar la orden {numeroOrden}
          </AlertDialogTitle>
          <AlertDialogDescription>
            El proveedor confirmó plazo y disponibilidad. Registrá la fecha de
            entrega comprometida — es la base del seguimiento de cumplimiento. La
            orden pasa a estado CONFIRMADA.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`fecha-entrega-${ordenCompraId}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Fecha de entrega comprometida
          </label>
          <input
            id={`fecha-entrega-${ordenCompraId}`}
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede confirmar la orden sin una fecha.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
            Volver
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={!fechaValida || isPending}
            onClick={handleConfirm}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Confirmando…
              </>
            ) : (
              <>
                <CalendarCheck className="size-4" aria-hidden="true" />
                Confirmar orden
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
