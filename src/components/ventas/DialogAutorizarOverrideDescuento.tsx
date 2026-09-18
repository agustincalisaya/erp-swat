"use client";

/**
 * @component DialogAutorizarOverrideDescuento
 * @description HU-B4 — Autorización de un descuento fuera de margen o de un
 * cambio manual de precio sobre un `PedidoVentaItem` en espera de aprobación
 * (spec §2.4). Mismo patrón que `ModalReclasificacion.tsx`: `AlertDialog` +
 * `useState` manual + Server Action, sin react-hook-form.
 *
 * Identificación del Supervisor autorizante (docs/tasks/HU-B4.md §2, punto
 * relevado y confirmado con el usuario): selector NOMINAL — el
 * `AutorizarOverrideDescuentoSchema` solo transporta `usuario_id` (sin
 * contraseña), así que no hay re-autenticación acá; el backend igual
 * re-valida el permiso real del `usuario_id` elegido dentro de la
 * transacción del servicio. El Dialog en sí ya está gateado por
 * `usuarioTienePermiso("ventas:autorizar_excepcion_descuento")` en el RSC
 * padre (mismo patrón que `DialogAceptarPresupuesto.tsx`) — solo se renderiza
 * para quien puede autorizar.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, AlertTriangle } from "lucide-react";

import { autorizarOverrideDescuentoAction } from "@/app/(dashboard)/ventas/pos/actions";
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
import { Input } from "@/components/ui/input";
import type { SupervisorParaSelector } from "@/lib/services/ventas/pedido-venta.service";

type TipoAjuste = "DESCUENTO" | "PRECIO";

interface DialogAutorizarOverrideDescuentoProps {
  pedidoVentaId: string;
  varianteSkuId: string;
  itemLabel: string;
  supervisores: SupervisorParaSelector[];
}

export function DialogAutorizarOverrideDescuento({
  pedidoVentaId,
  varianteSkuId,
  itemLabel,
  supervisores,
}: DialogAutorizarOverrideDescuentoProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tipoAjuste, setTipoAjuste] = useState<TipoAjuste>("DESCUENTO");
  const [descuentoPorcentual, setDescuentoPorcentual] = useState("");
  const [precioModificado, setPrecioModificado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setTipoAjuste("DESCUENTO");
    setDescuentoPorcentual("");
    setPrecioModificado("");
    setMotivo("");
    setSupervisorId("");
    setServerError(null);
  }, []);

  const valorValido =
    tipoAjuste === "DESCUENTO"
      ? descuentoPorcentual.trim() !== "" &&
        Number(descuentoPorcentual) >= 0 &&
        Number(descuentoPorcentual) <= 100
      : precioModificado.trim() !== "" && Number(precioModificado) > 0;
  const confirmacionHabilitada = valorValido && motivo.trim().length > 0 && supervisorId !== "";

  const handleConfirm = () => {
    setServerError(null);
    startTransition(async () => {
      const resultado = await autorizarOverrideDescuentoAction(pedidoVentaId, {
        variante_sku_id: varianteSkuId,
        ...(tipoAjuste === "DESCUENTO"
          ? { descuento_porcentual_solicitado: Number(descuentoPorcentual) }
          : { precio_lista_modificado: Number(precioModificado) }),
        motivo: motivo.trim(),
        supervisor_credencial: { usuario_id: supervisorId },
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
        Autorizar excepción
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-700">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Autorizar excepción — {itemLabel}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Solo un Supervisor de Ventas puede autorizar un descuento fuera de margen o un
            cambio manual de precio. La operación queda registrada como evento sensible en el
            log de auditoría.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {/* Tipo de ajuste — mutuamente explicativo en la UI aunque el
              schema permite ambos a la vez (docs/tasks/HU-B4.md §2). */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-700">
              Tipo de ajuste
            </legend>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTipoAjuste("DESCUENTO")}
                aria-pressed={tipoAjuste === "DESCUENTO"}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  tipoAjuste === "DESCUENTO"
                    ? "border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-500/30"
                    : "border-input bg-background text-gray-700 hover:border-amber-300 hover:bg-amber-50/50"
                }`}
              >
                Descuento porcentual
              </button>
              <button
                type="button"
                onClick={() => setTipoAjuste("PRECIO")}
                aria-pressed={tipoAjuste === "PRECIO"}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  tipoAjuste === "PRECIO"
                    ? "border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-500/30"
                    : "border-input bg-background text-gray-700 hover:border-amber-300 hover:bg-amber-50/50"
                }`}
              >
                Precio de lista modificado
              </button>
            </div>
          </fieldset>

          {tipoAjuste === "DESCUENTO" ? (
            <div className="space-y-1.5">
              <Label htmlFor="override-descuento" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                Descuento (%)
              </Label>
              <Input
                id="override-descuento"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={descuentoPorcentual}
                onChange={(e) => setDescuentoPorcentual(e.target.value)}
                placeholder="Ej: 12.5"
                className="text-sm"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="override-precio" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                Precio de lista modificado
              </Label>
              <Input
                id="override-precio"
                type="number"
                min={0.01}
                step="0.01"
                value={precioModificado}
                onChange={(e) => setPrecioModificado(e.target.value)}
                placeholder="Nuevo precio unitario"
                className="text-sm"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="override-supervisor" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
              Supervisor autorizante
            </Label>
            <select
              id="override-supervisor"
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">Elegí el Supervisor que autoriza…</option>
              {supervisores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre_completo}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Selector nominal — el sistema no pide contraseña acá; la autorización se
              valida server-side contra el permiso real de la persona elegida.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="override-motivo" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
              Motivo
            </Label>
            <textarea
              id="override-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: cliente institucional, negociación puntual autorizada por Supervisor"
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
            className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Autorizando…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" aria-hidden="true" />
                Confirmar autorización
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
