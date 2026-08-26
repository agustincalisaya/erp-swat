"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, History, PackageCheck, Search, Truck } from "lucide-react";
import { crearTransferenciaAction, confirmarRecepcionTransferenciaAction, obtenerStockDisponibleAction } from "@/app/(dashboard)/inventario/movimientos/actions";
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";
import type { TransferenciaListado, VarianteTransferible } from "@/lib/services/inventario/transferencia.service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { buttonVariants } from "@/components/ui/button";

interface Props {
  variantes: VarianteTransferible[];
  depositos: DepositoActivo[];
  transferencias: TransferenciaListado[];
  puedeTransferir: boolean;
  puedeConfirmar: boolean;
}

interface RemitoGenerado {
  transferencia_id: string;
  remito_id: string;
  estado: "EN_TRANSITO";
  cantidad: number;
  deposito_origen_id: string;
  deposito_destino_id: string;
}

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const fechaHoraPartesFormatter = new Intl.DateTimeFormat("en-CA", {
  calendar: "gregory",
  numberingSystem: "latn",
  timeZone: "America/Argentina/Salta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatearFechaHora(timestamp: Date | string): string {
  const partes = fechaHoraPartesFormatter.formatToParts(new Date(timestamp));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const ascii = (tipo: Intl.DateTimeFormatPartTypes) => String(Number(valor(tipo))).padStart(2, "0");

  return `${ascii("day")}/${ascii("month")}/${valor("year")} ${ascii("hour")}:${ascii("minute")}`;
}

export function TransferenciasPanel({ variantes, depositos, transferencias, puedeTransferir, puedeConfirmar }: Props) {
  const router = useRouter();
  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? "");
  const [origenId, setOrigenId] = useState(depositos[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState(depositos[1]?.id ?? "");
  const [cantidad, setCantidad] = useState(1);
  const [disponible, setDisponible] = useState<number | null>(null);
  const [remito, setRemito] = useState<RemitoGenerado | null>(null);
  const [busquedaPendientes, setBusquedaPendientes] = useState("");
  const [paginaPendientes, setPaginaPendientes] = useState(1);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!varianteId || !origenId || !puedeTransferir) {
      return;
    }
    let vigente = true;
    void obtenerStockDisponibleAction(varianteId, origenId).then((resultado) => {
      if (!vigente) return;
      setDisponible(resultado.success ? resultado.data?.cantidad ?? 0 : null);
    });
    return () => { vigente = false; };
  }, [varianteId, origenId, puedeTransferir, transferencias]);

  function despachar() {
    startTransition(async () => {
      const resultado = await crearTransferenciaAction({
        variante_sku_id: varianteId,
        deposito_origen_id: origenId,
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

  function confirmar(id: string) {
    startTransition(async () => {
      const resultado = await confirmarRecepcionTransferenciaAction(id);
      if (!resultado.success) {
        toast.add({ title: "No se pudo confirmar la recepción", description: resultado.error?.message ?? "Error inesperado", type: "error" });
        return;
      }
      setRemito((remitoActual) => remitoActual?.transferencia_id === id ? null : remitoActual);
      toast.add({ title: "Recepción confirmada", description: "El stock ya está disponible en destino.", type: "success" });
      router.refresh();
    });
  }

  const pendientes = transferencias.filter((item) => item.estado === "EN_TRANSITO");
  const terminoPendientes = busquedaPendientes.trim().toLocaleLowerCase("es");
  const pendientesFiltrados = terminoPendientes
    ? pendientes.filter((item) => [item.numero_remito, item.sku, item.producto_nombre, item.deposito_origen, item.deposito_destino]
        .some((valor) => valor.toLocaleLowerCase("es").includes(terminoPendientes)))
    : pendientes;
  const totalPaginasPendientes = Math.max(1, Math.ceil(pendientesFiltrados.length / 10));
  const paginaPendientesValida = Math.min(paginaPendientes, totalPaginasPendientes);
  const pendientesVisibles = pendientesFiltrados.slice((paginaPendientesValida - 1) * 10, paginaPendientesValida * 10);
  const remitoVisible = remito && pendientes.some((item) => item.id === remito.transferencia_id) ? remito : null;

  return (
    <section className="space-y-5" aria-labelledby="transferencias-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="transferencias-title" className="text-xl font-bold text-gray-900">Transferencias entre depósitos</h2>
          <p className="text-sm text-muted-foreground">El stock despachado queda fuera de la disponibilidad comercial hasta confirmar su recepción.</p>
        </div>
        <Link href="/inventario/movimientos/historial-transferencias" className={buttonVariants({ variant: "outline" })}>
          <History className="size-4" /> Historial de Transferencias
        </Link>
      </div>

      {puedeTransferir ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck className="size-5" /> Nuevo despacho</CardTitle>
            <CardDescription>Generá el remito interno y pasá las unidades a EN_TRANSITO.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 lg:col-span-2">
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
                <Label htmlFor="transferencia-origen">Depósito origen</Label>
                <select id="transferencia-origen" className={selectClass} value={origenId} onChange={(event) => { setDisponible(null); setOrigenId(event.target.value); }}>
                  {depositos.map((deposito) => <option key={deposito.id} value={deposito.id}>{deposito.nombre}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transferencia-destino">Depósito destino</Label>
                <select id="transferencia-destino" className={selectClass} value={destinoId} onChange={(event) => setDestinoId(event.target.value)}>
                  {depositos.map((deposito) => <option key={deposito.id} value={deposito.id}>{deposito.nombre}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="transferencia-cantidad">Cantidad</Label>
                <Input id="transferencia-cantidad" type="number" min={1} step={1} value={cantidad} onChange={(event) => setCantidad(Number(event.target.value))} />
              </div>
              <div className="rounded-lg border bg-slate-50 px-4 py-3" aria-live="polite">
                <span className="block text-xs text-muted-foreground">Disponible comercial en origen</span>
                <strong className="text-2xl text-slate-900">{disponible ?? "…"}</strong>
              </div>
              <Button onClick={despachar} disabled={pending || disponible === null || !varianteId || !origenId || !destinoId || origenId === destinoId || cantidad < 1 || cantidad > disponible}>
                <ArrowRight className="size-4" /> {pending ? "Procesando…" : "Generar transferencia"}
              </Button>
            </div>
            {origenId === destinoId && <Alert variant="destructive"><AlertDescription>El depósito de origen y destino deben ser distintos.</AlertDescription></Alert>}
          </CardContent>
        </Card>
      ) : <Alert><AlertDescription>No tenés permiso para despachar transferencias.</AlertDescription></Alert>}

      {remitoVisible && (
        <Alert className="border-amber-300 bg-amber-50">
          <Truck className="size-4" />
          <AlertDescription><strong>Remito {remitoVisible.remito_id}</strong> · {remitoVisible.cantidad} unidades · <Badge variant="outline" className="border-amber-500 text-amber-700">EN_TRANSITO</Badge></AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>Remitos pendientes</CardTitle><CardDescription>Mercadería despachada que todavía no integra el disponible del destino.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={busquedaPendientes}
              onChange={(event) => { setBusquedaPendientes(event.target.value); setPaginaPendientes(1); }}
              placeholder="Buscar por remito, SKU, producto o depósito"
              aria-label="Buscar remitos pendientes"
              className="pl-9"
            />
          </div>
          <TablaTransferencias
            items={pendientesVisibles}
            puedeConfirmar={puedeConfirmar}
            pending={pending}
            onConfirmar={confirmar}
            emptyMessage={terminoPendientes ? "No hay remitos que coincidan con la búsqueda." : "No hay remitos pendientes."}
          />
          {pendientesFiltrados.length > 0 && (
            <Paginacion
              pagina={paginaPendientesValida}
              totalPaginas={totalPaginasPendientes}
              total={pendientesFiltrados.length}
              onAnterior={() => setPaginaPendientes(Math.max(1, paginaPendientesValida - 1))}
              onSiguiente={() => setPaginaPendientes(Math.min(totalPaginasPendientes, paginaPendientesValida + 1))}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function TablaTransferencias({ items, puedeConfirmar, pending, onConfirmar, emptyMessage = "No hay remitos en este estado." }: { items: TransferenciaListado[]; puedeConfirmar: boolean; pending: boolean; onConfirmar: (id: string) => void; emptyMessage?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Remito</TableHead><TableHead>SKU</TableHead><TableHead>Ruta</TableHead><TableHead>Cantidad</TableHead><TableHead>Estado</TableHead><TableHead>Fecha</TableHead>{puedeConfirmar && <TableHead />}</TableRow></TableHeader>
      <TableBody>{items.map((item) => (
        <TableRow key={item.id}>
          <TableCell className="font-medium">{item.numero_remito}</TableCell>
          <TableCell><span className="block">{item.sku}</span><span className="text-xs text-muted-foreground">{item.producto_nombre}</span></TableCell>
          <TableCell>{item.deposito_origen} <ArrowRight className="mx-1 inline size-3" /> {item.deposito_destino}</TableCell>
          <TableCell>{item.cantidad}</TableCell>
          <TableCell><Badge variant={item.estado === "EN_TRANSITO" ? "outline" : "secondary"}>{item.estado === "EN_TRANSITO" ? <Truck /> : <CheckCircle2 />}{item.estado}</Badge></TableCell>
          <TableCell>{formatearFechaHora(item.recibida_at ?? item.despachada_at)}</TableCell>
          {puedeConfirmar && <TableCell><Button size="sm" onClick={() => onConfirmar(item.id)} disabled={pending}><PackageCheck className="size-4" /> Confirmar recepción</Button></TableCell>}
        </TableRow>
      ))}</TableBody>
    </Table>
  );
}

function Paginacion({ pagina, totalPaginas, total, onAnterior, onSiguiente }: { pagina: number; totalPaginas: number; total: number; onAnterior: () => void; onSiguiente: () => void }) {
  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>Página {pagina} de {totalPaginas} — {total} remito{total === 1 ? "" : "s"}</span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAnterior} disabled={pagina <= 1}>Anterior</Button>
        <Button type="button" variant="outline" size="sm" onClick={onSiguiente} disabled={pagina >= totalPaginas}>Siguiente</Button>
      </div>
    </div>
  );
}
