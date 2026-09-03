"use client";

/**
 * @component DetalleMovimientoDialog
 * @description HU-A11 (spec_modulo_A.md §2.10) — vista de detalle de un
 * `MovimientoStock` del historial operativo. Modal (`Dialog` de
 * `components/ui/dialog.tsx`), único primitivo de overlay usado en el
 * proyecto — no hay `sheet.tsx`/drawer.
 *
 * Multi-ítem (HU-A11): en vez de campos singulares de SKU/cantidad, muestra
 * una tabla con todos los `MovimientoStockItem` del movimiento (SKU,
 * cantidad, estado origen/destino de cada uno) — los campos de cabecera
 * (depósito origen/destino, tipo, comprobante, registrado por, fecha) se
 * mantienen como estaban.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del movimiento</DialogTitle>
            <DialogDescription>{movimiento.movimiento_id}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Tipo de movimiento" valor={movimiento.tipo_movimiento} />
            <Campo etiqueta="Comprobante" valor={movimiento.comprobante_referencia ?? "—"} />
            <Campo etiqueta="Depósito origen" valor={movimiento.deposito_origen ?? "—"} />
            <Campo etiqueta="Depósito destino" valor={movimiento.deposito_destino ?? "—"} />
            <Campo etiqueta="Registrado por" valor={movimiento.registrado_por} />
            <Campo etiqueta="Fecha" valor={fechaCompletaFormatter.format(new Date(movimiento.created_at))} />
          </dl>

          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Ítems ({movimiento.items_count}) — {movimiento.cantidad_total} unidades en total
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU / Producto</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead>Estado origen</TableHead>
                    <TableHead>Estado destino</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimiento.items.map((item, index) => (
                    <TableRow key={`${item.variante_sku}-${index}`}>
                      <TableCell>
                        <span className="block font-mono text-xs">{item.variante_sku}</span>
                        <span className="text-xs text-muted-foreground">{item.producto_nombre}</span>
                      </TableCell>
                      <TableCell className="text-right">{item.cantidad}</TableCell>
                      <TableCell>{item.estado_origen ?? "—"}</TableCell>
                      <TableCell>{item.estado_destino ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
