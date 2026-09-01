"use client";

/**
 * @component DetalleMovimientoDialog
 * @description HU-A11 (spec_modulo_A.md §2.10) — vista de detalle de un
 * `MovimientoStock` del historial operativo. Modal (`Dialog` de
 * `components/ui/dialog.tsx`), único primitivo de overlay usado en el
 * proyecto — no hay `sheet.tsx`/drawer.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { MovimientoHistorialItem } from "@/lib/services/inventario/movimiento.service";

interface Props {
  movimiento: MovimientoHistorialItem | null;
  onOpenChange: (open: boolean) => void;
}

const fechaCompletaFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Salta",
  dateStyle: "long",
  timeStyle: "short",
});

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{etiqueta}</dt>
      <dd className="text-sm text-foreground">{valor}</dd>
    </div>
  );
}

export function DetalleMovimientoDialog({ movimiento, onOpenChange }: Props) {
  return (
    <Dialog open={movimiento !== null} onOpenChange={onOpenChange}>
      {movimiento && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Detalle del movimiento</DialogTitle>
            <DialogDescription>{movimiento.movimiento_id}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-4">
            <Campo etiqueta="SKU" valor={`${movimiento.variante_sku} — ${movimiento.producto_nombre}`} />
            <Campo etiqueta="Tipo de movimiento" valor={movimiento.tipo_movimiento} />
            <Campo etiqueta="Depósito origen" valor={movimiento.deposito_origen ?? "—"} />
            <Campo etiqueta="Depósito destino" valor={movimiento.deposito_destino ?? "—"} />
            <Campo etiqueta="Cantidad" valor={String(movimiento.cantidad)} />
            <Campo etiqueta="Estado origen" valor={movimiento.estado_origen ?? "—"} />
            <Campo etiqueta="Estado destino" valor={movimiento.estado_destino ?? "—"} />
            <Campo etiqueta="Comprobante" valor={movimiento.comprobante_referencia ?? "—"} />
            <Campo etiqueta="Registrado por" valor={movimiento.registrado_por} />
            <Campo etiqueta="Fecha" valor={fechaCompletaFormatter.format(new Date(movimiento.created_at))} />
          </dl>
        </DialogContent>
      )}
    </Dialog>
  );
}
