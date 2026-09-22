"use client";

/**
 * @component DialogBajaCliente
 * @description HU-C6 — baja lógica de un Cliente (spec_modulo_C.md §2.6 ·
 * RULES.md Regla N.° 1). NUNCA un borrado físico: el servicio marca
 * `is_active=false` + `deleted_*` y la ficha y el historial de compras siguen
 * siendo consultables.
 *
 * Mismo patrón que `DialogBaja` de proveedores: exige `deletion_reason` en el
 * propio modal antes de habilitar el botón (primera barrera); el schema Zod
 * server-side (`BajaClienteSchema`) es la segunda. La baja NO se bloquea por
 * pedidos/presupuestos abiertos ni por saldo de cuenta corriente. El permiso
 * `clientes:baja` lo resuelve el padre: este componente solo se renderiza si
 * `puedeBaja` (solo Administrador de CRM).
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";

import { bajaCliente } from "@/app/(dashboard)/clientes/actions";
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

interface DialogBajaClienteProps {
  clienteId: string;
  nombre: string;
  /** Modo controlado: el padre maneja el estado de apertura. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DialogBajaCliente({
  clienteId,
  nombre,
  open,
  onOpenChange,
}: DialogBajaClienteProps) {
  const router = useRouter();
  const [openInterno, setOpenInterno] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const esControlado = open !== undefined;

  const handleClose = useCallback(() => {
    if (esControlado) {
      onOpenChange?.(false);
    } else {
      setOpenInterno(false);
    }
    setMotivo("");
    setServerError(null);
  }, [esControlado, onOpenChange]);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = await bajaCliente(clienteId, {
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
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-red-50"
          onClick={() => setOpenInterno(true)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Dar de baja
        </Button>
      )}

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Dar de baja a {nombre}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Es una <strong>baja lógica</strong>: el cliente deja de poder operar
            (presupuestos, ventas, cuenta corriente), pero su ficha y su
            historial de compras se conservan y siguen siendo consultables. No
            puede deshacerse desde acá.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`motivo-baja-cliente-${clienteId}`}
            className="text-xs font-semibold uppercase tracking-wide text-gray-700"
          >
            Motivo de la baja
          </label>
          <textarea
            id={`motivo-baja-cliente-${clienteId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Cliente duplicado por error de carga."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Campo obligatorio — no se puede dar de baja sin un motivo.
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
                Dando de baja…
              </>
            ) : (
              <>
                <Trash2 className="size-4" aria-hidden="true" />
                Confirmar baja
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
