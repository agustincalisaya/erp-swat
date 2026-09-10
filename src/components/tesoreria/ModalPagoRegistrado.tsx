"use client";

/**
 * @component ModalPagoRegistrado
 * @description HU-G10 — read-back de un pago recién registrado
 * (spec_modulo_G.md §2.4). Renderiza el objeto `data` que devolvió la Server
 * Action (shape 200 de `PATCH /api/tesoreria/cuentas-por-pagar/[id]/pagar`):
 * NO hace ningún fetch nuevo, NO navega a otra ruta. Al cerrarse, el padre
 * refresca el listado (la cuenta ya no está en `DEFINITIVA`).
 */

import { CheckCircle2 } from "lucide-react";

import { MEDIOS_PAGO } from "@/lib/schemas/cuentas-por-pagar.schema";
import { CUENTAS_ORIGEN } from "@/lib/tesoreria/cuentas-origen";
import type { CuentaPorPagarPagada } from "@/lib/services/tesoreria/cuenta-por-pagar.service";

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

const MEDIO_PAGO_LABEL: Record<(typeof MEDIOS_PAGO)[number], string> = {
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  EFECTIVO: "Efectivo",
};

function etiquetaCuentaOrigen(id: string): string {
  return CUENTAS_ORIGEN.find((c) => c.id === id)?.label ?? id;
}

function etiquetaMedioPago(medio: string): string {
  return MEDIO_PAGO_LABEL[medio as (typeof MEDIOS_PAGO)[number]] ?? medio;
}

/**
 * `fecha_pago` es una fecha de calendario que en la DB queda a medianoche UTC
 * (`z.coerce.date()` sobre un `YYYY-MM-DD`). Se formatea tomando año/mes/día
 * del ISO en UTC — NO se pasa por `toLocaleDateString` con la zona horaria
 * local del browser, que en UTC-3 correría el día mostrado un día hacia atrás.
 */
function formatearFechaPago(fecha: Date | string): string {
  const [anio, mes, dia] = new Date(fecha).toISOString().slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

interface ModalPagoRegistradoProps {
  data: CuentaPorPagarPagada | null;
  numeroOrden: string;
  onClose: () => void;
}

export function ModalPagoRegistrado({
  data,
  numeroOrden,
  onClose,
}: ModalPagoRegistradoProps) {
  return (
    <Dialog
      open={data !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {data && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Pago registrado — {numeroOrden}
              </DialogTitle>
              <DialogDescription>
                La cuenta por pagar quedó en estado {data.estado_nuevo}. Detalle
                de lo que se registró:
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Estado</dt>
              <dd className="font-medium">
                {data.estado_anterior} → {data.estado_nuevo}
              </dd>

              <dt className="text-muted-foreground">Fecha de pago</dt>
              <dd>{formatearFechaPago(data.fecha_pago)}</dd>

              <dt className="text-muted-foreground">Medio de pago</dt>
              <dd>{etiquetaMedioPago(data.medio_pago)}</dd>

              <dt className="text-muted-foreground">Cuenta de origen</dt>
              <dd>{etiquetaCuentaOrigen(data.cuenta_origen_id)}</dd>

              <dt className="text-muted-foreground">Comprobantes</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-4">
                  {data.comprobante_proveedor_ids.map((id) => (
                    <li key={id} className="font-mono text-xs">
                      {id}
                    </li>
                  ))}
                </ul>
              </dd>

              <dt className="text-muted-foreground">Observaciones</dt>
              <dd className="whitespace-pre-wrap">{data.observaciones ?? "—"}</dd>
            </dl>

            <DialogFooter>
              <DialogClose render={<Button type="button" className="gap-2" />}>
                Cerrar
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
