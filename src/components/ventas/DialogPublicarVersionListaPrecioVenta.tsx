"use client";

/**
 * @component DialogPublicarVersionListaPrecioVenta
 * @description HU-B9 — confirmación de "Publicar versión" de la Lista de
 * Precios de Venta. Mismo patrón que `DialogResolverExcepcionCredito`
 * (`AlertDialog` + `useTransition` + Server Action) y que
 * `FormularioRegistrarComprobante` para el cierre: `router.refresh()` ANTES
 * de cerrar el diálogo (lección HU-H9), después toast.
 *
 * El payload ya llega validado por `construirPayloadVersion()`; el botón
 * queda deshabilitado mientras no haya ítems válidos.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertTriangle } from "lucide-react";

import { publicarVersionListaPrecioVentaAction } from "@/app/(dashboard)/ventas/lista-precios/actions";
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
import { toast } from "@/components/ui/toast";
import type { ResultadoPayload } from "@/components/ventas/lista-precios-venta.calculo";

function formatDia(diaIso: string): string {
  const [anio, mes, dia] = diaIso.split("-");
  return `${dia}/${mes}/${anio}`;
}

interface DialogPublicarVersionListaPrecioVentaProps {
  resultado: ResultadoPayload;
  /** Día elegido (`AAAA-MM-DD`), solo para mostrarlo en la confirmación. */
  vigenteDesdeDia: string;
  onPublicada: () => void;
  /** Variante rechazada por el servidor por bajo costo sin motivo. */
  onFilaRechazada: (varianteSkuId: string) => void;
}

export function DialogPublicarVersionListaPrecioVenta({
  resultado,
  vigenteDesdeDia,
  onPublicada,
  onFilaRechazada,
}: DialogPublicarVersionListaPrecioVentaProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setOpen(false);
    setServerError(null);
  }, []);

  const handleConfirm = () => {
    if (!resultado.ok) return;
    const { payload } = resultado;
    setServerError(null);
    startTransition(async () => {
      const respuesta = await publicarVersionListaPrecioVentaAction(payload);
      if (respuesta.error) {
        setServerError(respuesta.error.message);
        const details = respuesta.error.details as { variante_sku_id?: string } | undefined;
        if (respuesta.error.code === "MOTIVO_BAJO_COSTO_REQUERIDO" && details?.variante_sku_id) {
          onFilaRechazada(details.variante_sku_id);
        }
        return;
      }
      router.refresh();
      toast.add({
        title: "Versión publicada",
        description: `${respuesta.data.items_publicados} precio(s) vigentes desde el ${formatDia(vigenteDesdeDia)}.`,
        type: "success",
      });
      onPublicada();
      handleClose();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <AlertDialogTrigger
        disabled={!resultado.ok}
        render={
          <Button
            type="button"
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:pointer-events-none disabled:opacity-50"
          />
        }
      >
        <Send className="size-4" aria-hidden="true" />
        Publicar versión
      </AlertDialogTrigger>

      {resultado.ok && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar versión de la lista de precios</AlertDialogTitle>
            <AlertDialogDescription>
              Se publicará una versión nueva con {resultado.payload.items.length} precio(s),
              vigente desde el {formatDia(vigenteDesdeDia)}, para mostrador y e-commerce. La
              versión actual no se modifica y las variantes no incluidas mantienen su precio. La
              publicación queda registrada en el log de auditoría.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {resultado.items_bajo_costo > 0 && (
            <Alert>
              <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
              <AlertDescription>
                {resultado.items_bajo_costo} precio(s) quedan por debajo del costo de reposición,
                con motivo declarado.
              </AlertDescription>
            </Alert>
          )}

          {serverError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending} onClick={handleClose}>
              Cancelar
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
                  Publicando…
                </>
              ) : (
                <>
                  <Send className="size-4" aria-hidden="true" />
                  Confirmar publicación
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
