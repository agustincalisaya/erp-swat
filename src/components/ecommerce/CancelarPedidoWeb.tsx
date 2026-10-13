"use client";

import type { EstadoEcommerce } from "@prisma/client";
import { useRef, useState, type SubmitEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cancelarPedidoWebApi, mensajeErrorCancelacion } from "@/lib/ecommerce/cancelacion-pedido-web.client";

const CLASE_TEXTAREA =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CancelarPedidoWeb({
  pedidoId,
  numero,
  estado,
  onCancelado,
}: {
  pedidoId: string;
  numero: string;
  estado: EstadoEcommerce;
  onCancelado: () => void;
}) {
  const enviandoRef = useRef(false);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const motivoValido = motivo.trim().length > 0;
  const puedeCancelar = estado === "PAGO_CONFIRMADO" && !bloqueado && !exito;

  const cambiarApertura = (nuevoEstado: boolean) => {
    if (enviandoRef.current) return;
    setAbierto(nuevoEstado);
    if (!nuevoEstado) {
      setMotivo("");
      setError(null);
    }
  };

  const enviar = async (evento: SubmitEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!motivoValido || enviandoRef.current || !puedeCancelar) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    const resultado = await cancelarPedidoWebApi(pedidoId, motivo);
    enviandoRef.current = false;
    setEnviando(false);

    if (!resultado.ok) {
      setError(mensajeErrorCancelacion(resultado.status));
      if (resultado.status === 401) {
        const retorno = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/tienda/ingresar?redirect=${encodeURIComponent(retorno)}`);
      } else if (resultado.status === 409) {
        setBloqueado(true);
        setAbierto(false);
        window.setTimeout(() => window.location.reload(), 750);
      }
      return;
    }
    if (
      resultado.json.data?.pedido_venta_id !== pedidoId ||
      resultado.json.data.estado_ecommerce !== "CANCELADO" ||
      resultado.json.data.reintegro_iniciado !== true
    ) {
      setError("No pudimos confirmar la cancelación. Actualizá la página e intentá nuevamente.");
      return;
    }

    setExito(true);
    setAbierto(false);
    setMotivo("");
    onCancelado();
    window.setTimeout(() => window.location.reload(), 750);
  };

  return (
    <div className="space-y-3">
      {exito && (
        <Alert role="status">
          <AlertDescription>
            Pedido cancelado correctamente. Se inició el proceso de reintegro.
          </AlertDescription>
        </Alert>
      )}
      {error && !abierto && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {puedeCancelar && (
        <Button type="button" variant="destructive" onClick={() => cambiarApertura(true)}>
          Cancelar pedido
        </Button>
      )}

      <Dialog open={abierto} onOpenChange={cambiarApertura}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancelar pedido {numero}</DialogTitle>
            <DialogDescription>
              El pedido será cancelado y ya no podrá retirarse. Se iniciará el proceso de reintegro correspondiente.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={enviar} className="space-y-4">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`motivo-cancelacion-${pedidoId}`}>Motivo de cancelación</Label>
              <textarea
                id={`motivo-cancelacion-${pedidoId}`}
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                rows={4}
                required
                disabled={enviando}
                aria-invalid={!motivoValido && motivo.length > 0}
                aria-describedby={`ayuda-cancelacion-${pedidoId}`}
                placeholder="Contanos por qué querés cancelar el pedido."
                className={CLASE_TEXTAREA}
              />
              <p id={`ayuda-cancelacion-${pedidoId}`} className="text-xs text-muted-foreground">
                El motivo es obligatorio.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => cambiarApertura(false)} disabled={enviando}>
                Volver
              </Button>
              <Button type="submit" variant="destructive" disabled={!motivoValido || enviando}>
                {enviando ? "Cancelando…" : "Confirmar cancelación"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
