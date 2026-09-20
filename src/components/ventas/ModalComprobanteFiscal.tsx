"use client";

/**
 * @component ModalComprobanteFiscal
 * @description HU-B7 §2.7 — Detalle mínimo de un comprobante fiscal ya
 * emitido (CAE simulado + QR), consultado bajo demanda al hacer clic en "Ver
 * comprobante" del panel de resultado de `/ventas/pos` (task_relos.md §5:
 * "no requiere routing propio ni pantalla dedicada"). Hace su propio fetch a
 * `GET /api/ventas/comprobantes/[id]` — no recibe el detalle por props,
 * a diferencia de `ModalPagoRegistrado` (que solo hace read-back de lo que
 * ya devolvió otra llamada).
 *
 * `DetalleComprobante` se monta con `key={comprobanteId}` (patrón "resetear
 * estado con key" de la doc de React, no un efecto que resetea manualmente):
 * cada comprobante nuevo es una instancia de componente nueva, con su propio
 * estado fresco desde el `useState` inicial — sin necesidad de un `useEffect`
 * que dispare `setState` síncrono al abrir/cambiar de comprobante
 * (react-hooks/set-state-in-effect). El único `setState` dentro del efecto de
 * fetch ocurre en los callbacks de la promesa, nunca en el cuerpo síncrono
 * del efecto.
 */

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ComprobanteFiscalConsultado } from "@/lib/services/ventas/comprobante-fiscal.service";

interface ModalComprobanteFiscalProps {
  /** `null` = modal cerrado. */
  comprobanteId: string | null;
  onClose: () => void;
}

const formatearMoneda = (valor: number) =>
  valor.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

function DetalleComprobante({ comprobanteId }: { comprobanteId: string }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<ComprobanteFiscalConsultado | null>(null);

  useEffect(() => {
    let cancelado = false;

    fetch(`/api/ventas/comprobantes/${comprobanteId}`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelado) return;
        if (!res.ok || json.error) {
          setError(json.error?.message ?? "No se pudo obtener el comprobante.");
          return;
        }
        setDetalle(json.data as ComprobanteFiscalConsultado);
      })
      .catch(() => {
        if (!cancelado) setError("No se pudo obtener el comprobante.");
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [comprobanteId]);

  if (cargando) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando comprobante…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!detalle) return null;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Tipo</dt>
        <dd className="font-medium">{detalle.tipo_comprobante}</dd>

        <dt className="text-muted-foreground">CAE simulado</dt>
        <dd className="font-mono">{detalle.cae_simulado}</dd>

        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-medium">{formatearMoneda(detalle.monto_total)}</dd>
      </dl>

      <div className="flex justify-center rounded-lg border border-border bg-muted/20 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL local, no aplica optimización de next/image */}
        <img
          src={detalle.qr_data_url}
          alt="Código QR del comprobante fiscal simulado"
          className="size-48"
        />
      </div>
    </div>
  );
}

export function ModalComprobanteFiscal({ comprobanteId, onClose }: ModalComprobanteFiscalProps) {
  return (
    <Dialog
      open={comprobanteId !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-600" aria-hidden="true" />
            Comprobante fiscal
          </DialogTitle>
          <DialogDescription>
            CAE y código QR generados localmente (simulados) — sin integración real con AFIP.
          </DialogDescription>
        </DialogHeader>

        {comprobanteId && <DetalleComprobante key={comprobanteId} comprobanteId={comprobanteId} />}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
