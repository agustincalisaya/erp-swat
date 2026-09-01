"use client";

/**
 * @component PasoTransferencia
 * @description HU-A11 — paso 3 del wizard para tipo "Transferencia". Extrae
 * el formulario de "Nuevo despacho" de la ex `TransferenciasPanel.tsx`
 * (HU-A4), invocando `crearTransferenciaAction`/`obtenerStockDisponibleAction`
 * (`movimientos/actions.ts`) sin modificarlas.
 *
 * Diferencia con el panel original: el depósito origen ya no se elige acá —
 * viene fijo del paso 1 del wizard (spec_modulo_A.md §2.10). El paso solo
 * pide producto, depósito destino y cantidad.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Truck } from "lucide-react";

import {
  crearTransferenciaAction,
  obtenerStockDisponibleAction,
} from "@/app/(dashboard)/inventario/movimientos/actions";
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";
import type { VarianteTransferible } from "@/lib/services/inventario/transferencia.service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { toast } from "@/components/ui/toast";

interface Props {
  depositoOrigenId: string;
  depositoOrigenNombre: string;
  depositos: DepositoActivo[];
  variantes: VarianteTransferible[];
}

interface RemitoGenerado {
  transferencia_id: string;
  remito_id: string;
  estado: "EN_TRANSITO";
  cantidad: number;
  deposito_origen_id: string;
  deposito_destino_id: string;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export function PasoTransferencia({ depositoOrigenId, depositoOrigenNombre, depositos, variantes }: Props) {
  const router = useRouter();
  const depositosDestino = depositos.filter((d) => d.id !== depositoOrigenId);

  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState(depositosDestino[0]?.id ?? "");
  const [cantidad, setCantidad] = useState(1);
  const [disponible, setDisponible] = useState<number | null>(null);
  const [remito, setRemito] = useState<RemitoGenerado | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!varianteId || !depositoOrigenId) return;
    let vigente = true;
    void obtenerStockDisponibleAction(varianteId, depositoOrigenId).then((resultado) => {
      if (!vigente) return;
      setDisponible(resultado.success ? resultado.data?.cantidad ?? 0 : null);
    });
    return () => { vigente = false; };
  }, [varianteId, depositoOrigenId]);

  function despachar() {
    startTransition(async () => {
      const resultado = await crearTransferenciaAction({
        variante_sku_id: varianteId,
        deposito_origen_id: depositoOrigenId,
        deposito_destino_id: destinoId,
        cantidad,
      });
      if (!resultado.success || !resultado.data) {
        toast.add({ title: "No se pudo generar la transferencia", description: resultado.error?.message ?? "Error inesperado", type: "error" });
        return;
      }
      setRemito(resultado.data as RemitoGenerado);
      toast.add({ title: "Remito generado", description: "La mercadería quedó EN_TRANSITO.", type: "success" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-sm text-blue-900">
        <Building2 className="size-4 text-blue-600" aria-hidden="true" />
        Depósito origen: <span className="font-semibold">{depositoOrigenNombre}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Truck className="size-5" /> Nuevo despacho</CardTitle>
          <CardDescription>Generá el remito interno y pasá las unidades a EN_TRANSITO.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="transferencia-sku">SKU</Label>
              <ComboboxFiltrable
                id="transferencia-sku"
                items={variantes}
                getId={(variante) => variante.id}
                getLabel={(variante) => `${variante.sku} — ${variante.nombre} (${variante.detalle})`}
                value={varianteId}
                onChange={(variante) => { setDisponible(null); setVarianteId(variante.id); }}
                placeholder="Buscar por SKU, producto, talle o color"
                emptyMessage="No hay SKU que coincidan con la búsqueda."
                pageSize={5}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transferencia-destino">Depósito destino</Label>
              <select
                id="transferencia-destino"
                className={selectClass}
                value={destinoId}
                onChange={(event) => setDestinoId(event.target.value)}
              >
                {depositosDestino.map((deposito) => (
                  <option key={deposito.id} value={deposito.id}>{deposito.nombre}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="transferencia-cantidad">Cantidad</Label>
              <Input
                id="transferencia-cantidad"
                type="number"
                min={1}
                step={1}
                value={cantidad}
                onChange={(event) => setCantidad(Number(event.target.value))}
              />
            </div>
            <div className="rounded-lg border bg-slate-50 px-4 py-3" aria-live="polite">
              <span className="block text-xs text-muted-foreground">Disponible comercial en origen</span>
              <strong className="text-2xl text-slate-900">{disponible ?? "…"}</strong>
            </div>
            <Button
              onClick={despachar}
              disabled={pending || disponible === null || !varianteId || !destinoId || cantidad < 1 || (disponible !== null && cantidad > disponible)}
            >
              <ArrowRight className="size-4" /> {pending ? "Procesando…" : "Generar transferencia"}
            </Button>
          </div>
          {depositosDestino.length === 0 && (
            <Alert variant="destructive">
              <AlertDescription>No hay otro depósito activo disponible como destino.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {remito && (
        <Alert className="border-amber-300 bg-amber-50">
          <Truck className="size-4" />
          <AlertDescription>
            <strong>Remito {remito.remito_id}</strong> · {remito.cantidad} unidades ·{" "}
            <Badge variant="outline" className="border-amber-500 text-amber-700">EN_TRANSITO</Badge>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
