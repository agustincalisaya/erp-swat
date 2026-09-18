"use client";

/**
 * @component DialogResolverExcepcionCredito
 * @description HU-B5 — Aprobación o rechazo de una `CuentaCorrienteOperacion`
 * RETENIDA por exceso de límite de crédito (task HU-B5 §2.3/§2.6). Mismo
 * patrón que `DialogAutorizarOverrideDescuento` (HU-B4): `AlertDialog` +
 * `useState` manual + Server Action, con `motivo` obligatorio.
 *
 * A diferencia de HU-B4 no hay selector de Supervisor: quien resuelve es el
 * usuario de la sesión (el endpoint exige `ventas:autorizar_excepcion_credito`).
 * El Dialog se gatea en el RSC padre con
 * `usuarioTienePermiso("ventas:autorizar_excepcion_credito")` — solo se
 * renderiza para Supervisor de Ventas.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, AlertTriangle } from "lucide-react";

import { resolverExcepcionCreditoAction } from "@/app/(dashboard)/ventas/cuentas-corrientes/actions";
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
import { Label } from "@/components/ui/label";

type Decision = "APROBAR" | "RECHAZAR";

interface DialogResolverExcepcionCreditoProps {
  operacionId: string;
  itemLabel: string;
  montoLabel: string;
}

export function DialogResolverExcepcionCredito({
  operacionId,
  itemLabel,
  montoLabel,
}: DialogResolverExcepcionCreditoProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>("APROBAR");
  const [motivo, setMotivo] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setDecision("APROBAR");
    setMotivo("");
    setServerError(null);
  }, []);

  const confirmacionHabilitada = motivo.trim().length > 0;

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = await resolverExcepcionCreditoAction(operacionId, {
        decision,
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

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
          />
        }
      >
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        Resolver excepción
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-700">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Resolver excepción de crédito — {itemLabel}
          </AlertDialogTitle>
          <AlertDialogDescription>
            La operación de {montoLabel} excede el límite de crédito disponible. Al aprobarla se
            suma al saldo de la cuenta (que puede quedar por encima del límite); al rechazarla el
            saldo no cambia. Ambas decisiones quedan registradas como evento sensible en el log de
            auditoría.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-700">
              Decisión
            </legend>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDecision("APROBAR")}
                aria-pressed={decision === "APROBAR"}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  decision === "APROBAR"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-500/30"
                    : "border-input bg-background text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50"
                }`}
              >
                Aprobar
              </button>
              <button
                type="button"
                onClick={() => setDecision("RECHAZAR")}
                aria-pressed={decision === "RECHAZAR"}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  decision === "RECHAZAR"
                    ? "border-red-500 bg-red-50 text-red-700 ring-2 ring-red-500/30"
                    : "border-input bg-background text-gray-700 hover:border-red-300 hover:bg-red-50/50"
                }`}
              >
                Rechazar
              </button>
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label
              htmlFor="resolver-motivo"
              className="text-xs font-semibold uppercase tracking-wide text-gray-700"
            >
              Motivo
            </Label>
            <textarea
              id="resolver-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: cliente con buen historial de pagos, autorizado por Gerencia"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-amber-500 focus-visible:ring-3 focus-visible:ring-amber-500/30"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={!confirmacionHabilitada || isPending}
            onClick={handleConfirm}
            className={`gap-2 text-white ${
              decision === "APROBAR"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Guardando…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" aria-hidden="true" />
                {decision === "APROBAR" ? "Confirmar aprobación" : "Confirmar rechazo"}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
