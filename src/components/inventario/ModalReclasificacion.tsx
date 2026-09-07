"use client";

/**
 * @component ModalReclasificacion
 * @description HU-A9 — Modal de reclasificación de una unidad DEVUELTO
 * (spec_modulo_A.md §2.8). El operador declara el resultado del control de
 * calidad físico: `APTO` → DISPONIBLE (reincorpora stock) o `NO_APTO` →
 * BAJA_MERMA (motivo obligatorio, misma regla de la sección 3.5). `rma_id`
 * es opcional (referencia al Módulo I, sin validación cruzada en Módulo A).
 *
 * Paleta azul Tailwind (`blue-*`) — requisito de la UI del Módulo A.
 * `useState` + Server Action, sin react-hook-form.
 */
import { useState, useTransition, useCallback } from "react";
import { RotateCcw, Loader2, PackageX, ShieldCheck } from "lucide-react";

import { reclasificarUnidadDevuelta } from "@/app/(dashboard)/inventario/devoluciones/actions";

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

export interface UnidadDevueltaResumen {
  id: string;
  variante_sku_id: string;
  deposito_id: string | null;
  sku: string;
  producto_nombre: string;
  cantidad: number;
  created_at: string;
}

interface ModalReclasificacionProps {
  unidad: UnidadDevueltaResumen;
}

type ResultadoControlCalidad = "APTO" | "NO_APTO";

export function ModalReclasificacion({ unidad }: ModalReclasificacionProps) {
  const [open, setOpen] = useState(false);
  const [resultado, setResultado] = useState<ResultadoControlCalidad>("APTO");
  const [motivo, setMotivo] = useState("");
  const [rmaId, setRmaId] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setResultado("APTO");
    setMotivo("");
    setRmaId("");
    setServerError(null);
  }, []);

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const result = await reclasificarUnidadDevuelta({
        variante_sku_id: unidad.variante_sku_id,
        deposito_id: unidad.deposito_id,
        cantidad: unidad.cantidad,
        resultado_control_calidad: resultado,
        // El schema (superRefine NO_APTO→motivo) y el service re-validan en
        // servidor; acá solo se omiten los campos vacíos.
        motivo: motivo.trim() === "" ? undefined : motivo.trim(),
        rma_id: rmaId.trim() === "" ? undefined : rmaId.trim(),
      });
      if (!result.success) {
        setServerError(result.error?.message ?? "Error desconocido.");
        return;
      }
      handleClose();
    });
  };

  const motivoRequerido = resultado === "NO_APTO";
  const confirmacionHabilitada = !motivoRequerido || motivo.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <AlertDialogTrigger
        render={
          <Button
            id={`btn-reclasificar-${unidad.id}`}
            variant="outline"
            size="sm"
            className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
          />
        }
      >
        <RotateCcw className="size-3.5" />
        Reclasificar
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-blue-700">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Reclasificar {unidad.sku} — {unidad.producto_nombre}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {unidad.cantidad} unidad(es) devuelta(s) en depósito de origen.
            Control de calidad físico: APTO reincorpora al stock comercial;
            NO_APTO da de baja por rotura u obsolescencia con motivo obligatorio.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {/* Resultado del control de calidad */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-700">
              Resultado del control de calidad
            </legend>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setResultado("APTO")}
                aria-pressed={resultado === "APTO"}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  resultado === "APTO"
                    ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/30"
                    : "border-input bg-background text-gray-700 hover:border-blue-300 hover:bg-blue-50/50"
                }`}
              >
                APTO — reincorporar
              </button>
              <button
                type="button"
                onClick={() => setResultado("NO_APTO")}
                aria-pressed={resultado === "NO_APTO"}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  resultado === "NO_APTO"
                    ? "border-red-400 bg-red-50 text-red-700 ring-2 ring-red-400/30"
                    : "border-input bg-background text-gray-700 hover:border-red-300 hover:bg-red-50/50"
                }`}
              >
                <PackageX className="mr-1 inline size-3.5" aria-hidden="true" />
                NO_APTO — baja/merma
              </button>
            </div>
          </fieldset>

          {motivoRequerido && (
            <div className="space-y-1.5">
              <label
                htmlFor={`motivo-reclasificacion-${unidad.id}`}
                className="text-xs font-semibold uppercase tracking-wide text-gray-700"
              >
                Motivo de la baja
              </label>
              <textarea
                id={`motivo-reclasificacion-${unidad.id}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: rotura de cierre en garantía, obsolescencia por cambio de temporada"
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/30"
              />
              <p className="text-xs text-muted-foreground">
                Campo obligatorio para NO_APTO — no se puede confirmar sin un motivo.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor={`rma-reclasificacion-${unidad.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-gray-700"
            >
              RMA (opcional)
            </label>
            <input
              id={`rma-reclasificacion-${unidad.id}`}
              type="text"
              value={rmaId}
              onChange={(e) => setRmaId(e.target.value)}
              placeholder="UUID del ticket RMA (Módulo I)"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/30"
            />
            <p className="text-xs text-muted-foreground">
              Referencia opcional de garantía — el Módulo A no valida su existencia.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleClose}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            variant="default"
            disabled={!confirmacionHabilitada || isPending}
            onClick={handleConfirm}
            className={`gap-2 ${resultado === "NO_APTO" ? "bg-red-600 text-white hover:bg-red-700" : "bg-blue-600 text-white hover:bg-blue-700"}`}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Reclasificando…
              </>
            ) : (
              <>
                <RotateCcw className="size-4" aria-hidden="true" />
                {resultado === "APTO" ? "Reincorporar al stock" : "Confirmar baja/merma"}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}