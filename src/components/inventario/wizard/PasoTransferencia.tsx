"use client";

/**
 * @component PasoTransferencia
 * @description HU-A11 — paso 3 del wizard para tipo "Transferencia". Extrae
 * el formulario de "Nuevo despacho" de la ex `TransferenciasPanel.tsx`
 * (HU-A4), invocando `crearTransferenciaAction`/`obtenerStockDisponibleAction`
 * (`movimientos/actions.ts`) sin modificarlas.
 *
 * Multi-ítem (HU-A11): "agregar" ya no despacha de inmediato — arma un
 * carrito local (editable/eliminable) con varias variantes+cantidades, y un
 * único botón "Generar transferencia" despacha TODO el carrito en un solo
 * llamado a `crearTransferenciaAction`, que ahora recibe
 * `{ deposito_origen_id, deposito_destino_id, items[] }`.
 *
 * Diferencia con el panel original: el depósito origen ya no se elige acá —
 * viene fijo del paso 1 del wizard (spec_modulo_A.md §2.10).
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, ShoppingCart, Trash2, Truck } from "lucide-react";

import {
  crearTransferenciaAction,
  obtenerStockDisponibleAction,
} from "@/app/(dashboard)/inventario/movimientos/actions";
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";
import type { TransferenciaCreada, VarianteTransferible } from "@/lib/services/inventario/transferencia.service";
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

interface CarritoItem {
  key: string;
  variante_sku_id: string;
  sku: string;
  nombre: string;
  detalle: string;
  cantidad: number;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export function PasoTransferencia({ depositoOrigenId, depositoOrigenNombre, depositos, variantes }: Props) {
  const router = useRouter();
  const depositosDestino = depositos.filter((d) => d.id !== depositoOrigenId);

  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState(depositosDestino[0]?.id ?? "");
  const [cantidadAAgregar, setCantidadAAgregar] = useState(1);
  const [disponible, setDisponible] = useState<number | null>(null);
  const [carrito, setCarrito] = useState<CarritoItem[]>([]);
  const [remito, setRemito] = useState<TransferenciaCreada | null>(null);
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

  const varianteSeleccionada = variantes.find((v) => v.id === varianteId);
  const cantidadTotalCarrito = carrito.reduce((acumulado, item) => acumulado + item.cantidad, 0);

  function agregarAlCarrito() {
    if (!varianteSeleccionada || cantidadAAgregar < 1) return;
    setCarrito((prev) => [
      ...prev,
      {
        key: `${varianteSeleccionada.id}-${Date.now()}`,
        variante_sku_id: varianteSeleccionada.id,
        sku: varianteSeleccionada.sku,
        nombre: varianteSeleccionada.nombre,
        detalle: varianteSeleccionada.detalle,
        cantidad: cantidadAAgregar,
      },
    ]);
    setCantidadAAgregar(1);
  }

  function actualizarCantidadCarrito(key: string, cantidad: number) {
    setCarrito((prev) =>
      prev.map((item) => (item.key === key ? { ...item, cantidad: Math.max(1, Math.trunc(cantidad) || 1) } : item)),
    );
  }

  function quitarDelCarrito(key: string) {
    setCarrito((prev) => prev.filter((item) => item.key !== key));
  }

  function vaciarCarrito() {
    setCarrito([]);
  }

  function despachar() {
    startTransition(async () => {
      const resultado = await crearTransferenciaAction({
        deposito_origen_id: depositoOrigenId,
        deposito_destino_id: destinoId,
        items: carrito.map((item) => ({ variante_sku_id: item.variante_sku_id, cantidad: item.cantidad })),
      });
      if (!resultado.success || !resultado.data) {
        toast.add({ title: "No se pudo generar la transferencia", description: resultado.error?.message ?? "Error inesperado", type: "error" });
        return;
      }
      setRemito(resultado.data as TransferenciaCreada);
      setCarrito([]);
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
          <CardTitle className="flex items-center gap-2"><Truck className="size-5" /> Agregar ítem al despacho</CardTitle>
          <CardDescription>Sumá las variantes y cantidades que va a llevar el remito.</CardDescription>
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
                value={cantidadAAgregar}
                onChange={(event) => setCantidadAAgregar(Number(event.target.value))}
              />
            </div>
            <div className="rounded-lg border bg-slate-50 px-4 py-3" aria-live="polite">
              <span className="block text-xs text-muted-foreground">Disponible comercial en origen</span>
              <strong className="text-2xl text-slate-900">{disponible ?? "…"}</strong>
            </div>
            <Button
              type="button"
              className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
              onClick={agregarAlCarrito}
              disabled={disponible === null || !varianteId || cantidadAAgregar < 1 || (disponible !== null && cantidadAAgregar > disponible)}
            >
              <ShoppingCart className="size-4" /> Agregar al carrito
            </Button>
          </div>
          {depositosDestino.length === 0 && (
            <Alert variant="destructive">
              <AlertDescription>No hay otro depósito activo disponible como destino.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="size-5" /> Carrito del remito
            {carrito.length > 0 && <Badge className="bg-blue-600 text-white">{carrito.length}</Badge>}
          </CardTitle>
          <CardDescription>Revisá las variantes y cantidades antes de generar el remito.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {carrito.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin ítems en el carrito todavía.</p>
          ) : (
            <ul className="space-y-2">
              {carrito.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-blue-950">{item.nombre}</p>
                    <p className="truncate text-xs text-blue-700">{item.sku} · {item.detalle}</p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    value={item.cantidad}
                    onChange={(e) => actualizarCantidadCarrito(item.key, Number(e.target.value))}
                    className="h-8 w-16 shrink-0"
                    aria-label={`Cantidad de ${item.nombre}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={() => quitarDelCarrito(item.key)}
                    aria-label={`Quitar ${item.nombre} del carrito`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1 bg-red-500 text-white hover:bg-red-600"
              onClick={vaciarCarrito}
              disabled={carrito.length === 0 || pending}
            >
              Vaciar carrito
            </Button>
            <Button
              type="button"
              className="flex-1 gap-2 bg-blue-600 text-white hover:bg-blue-700"
              onClick={despachar}
              disabled={pending || carrito.length === 0 || !destinoId}
            >
              <ArrowRight className="size-4" /> {pending ? "Procesando…" : `Generar transferencia (${cantidadTotalCarrito})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {remito && (
        <Alert className="border-amber-300 bg-amber-50">
          <Truck className="size-4" />
          <AlertDescription>
            <strong>Remito {remito.remito_id}</strong> · {remito.items.length} ítem{remito.items.length === 1 ? "" : "s"} ·{" "}
            {remito.items.reduce((acumulado, item) => acumulado + item.cantidad, 0)} unidades ·{" "}
            <Badge variant="outline" className="border-amber-500 text-amber-700">EN_TRANSITO</Badge>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
