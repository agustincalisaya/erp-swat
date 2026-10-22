"use client";

/**
 * @component ConfirmarPagoDialog
 * @description HU-E15 (E15-4/E15-5, docs/modulos/modulo E/HU15_MODULO_E.md
 * D4/D4.1/D5/P5/P8) — confirmación antes de salir a Mercado Pago.
 *
 * Muestra el total CONGELADO (`PedidoVenta.total`, neto de cupón, leído en el
 * servidor por la página: nunca se recalcula acá), el medio "Mercado Pago" y
 * los minutos restantes de la reserva, derivados de `ttlExpiracion` con el
 * reloj actual al abrir y refrescados mientras el diálogo está abierto (nunca
 * en el render del servidor: evita desfasajes de hidratación).
 *
 *  - Reserva vigente: "Continuar" navega a `checkoutUrl`; "Volver" solo cierra
 *    (sin request, sin refresh): no reinicia ni extiende la reserva.
 *  - Reserva vencida (minutos <= 0): sin "Continuar"; mensaje y "Volver al
 *    catálogo". Cerrar en ese estado hace `router.refresh()` para que la página
 *    se re-derive en el servidor y muestre "Reserva vencida" (solo lectura).
 *
 * Nunca crea ni consulta la preferencia de pago: recibe la URL ya resuelta
 * (si no hay URL, la vista no renderiza este componente — E15-6).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CreditCard } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatearPrecio } from "@/components/tienda/formato";
import { minutosRestantesReserva } from "@/lib/services/ecommerce/pedido-web.reglas";
import styles from "@/components/tienda/compra.module.css";

/** Cada cuánto se recalculan los minutos con el diálogo abierto. */
const REFRESCO_MINUTOS_MS = 15_000;

export function ConfirmarPagoDialog({
  total,
  ttlExpiracion,
  checkoutUrl,
}: {
  total: number;
  ttlExpiracion: string;
  checkoutUrl: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [minutos, setMinutos] = useState<number | null>(null);
  const vencida = minutos !== null && minutos <= 0;

  const recalcular = useCallback(
    () => setMinutos(minutosRestantesReserva(new Date(ttlExpiracion), new Date())),
    [ttlExpiracion],
  );

  useEffect(() => {
    if (!abierto) return;
    const intervalo = window.setInterval(recalcular, REFRESCO_MINUTOS_MS);
    return () => window.clearInterval(intervalo);
  }, [abierto, recalcular]);

  const cambiarApertura = (nuevoEstado: boolean) => {
    if (nuevoEstado) {
      recalcular();
      setAbierto(true);
      return;
    }
    setAbierto(false);
    // D4.1: solo en estado vencido se vuelve a leer la página (sin mutación).
    if (vencida) router.refresh();
  };

  return (
    <>
      <Button type="button" className={styles.paymentAction} onClick={() => cambiarApertura(true)}>
        <CreditCard size={18} aria-hidden="true" /> Pagar con Mercado Pago
      </Button>

      <Dialog open={abierto} onOpenChange={cambiarApertura}>
        <DialogContent className="sm:max-w-md">
          {vencida ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4" aria-hidden="true" /> Reserva vencida
                </DialogTitle>
                <DialogDescription>
                  El plazo para pagar terminó: la reserva venció y los artículos volvieron a estar disponibles. Podés
                  armar el carrito de nuevo e iniciar otra compra.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Link href="/tienda/catalogo" className={buttonVariants({ variant: "outline" })}>
                  Volver al catálogo
                </Link>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Confirmá tu pago</DialogTitle>
                <DialogDescription>Revisá el importe antes de continuar a Mercado Pago.</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Total a pagar</dt>
                  <dd className="text-base font-semibold tabular-nums">{formatearPrecio(total)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Medio de pago</dt>
                  <dd className="font-medium">Mercado Pago</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Tiempo restante de la reserva</dt>
                  <dd className="font-medium tabular-nums">
                    {minutos === null ? "—" : `${minutos} ${minutos === 1 ? "minuto" : "minutos"}`}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => cambiarApertura(false)}>
                  Volver
                </Button>
                <Button type="button" onClick={() => window.location.assign(checkoutUrl)}>
                  Continuar
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
