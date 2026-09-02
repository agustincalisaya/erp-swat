"use client";

/**
 * @component RecepcionesPendientesPanel
 * @description HU-A11 — reubicación de "confirmar recepción" tras el
 * borrado de la ex `TransferenciasPanel.tsx` (HU-A4): es la única
 * funcionalidad de ese panel que no tenía otro hogar en el wizard nuevo (el
 * despacho de transferencias pasó a `wizard/PasoTransferencia.tsx`). Invoca
 * `confirmarRecepcionTransferenciaAction` (`movimientos/actions.ts`) sin
 * modificarla.
 *
 * Multi-ítem + recepción parcial (HU-A11): cada fila (remito) es expandible
 * — al expandirla muestra sus `TransferenciaStockItem` con cantidad enviada,
 * ya recibida, y un input para cantidad a recibir ahora (máx. lo pendiente
 * de ese ítem). "Confirmar recepción" envía solo los ítems con cantidad > 0;
 * el resto queda pendiente sin acción explícita. El remito ahora puede
 * quedar en 3 estados: EN_TRANSITO, PARCIAL o RECIBIDA.
 */
import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, History, PackageCheck, Search, Truck } from "lucide-react";

import { confirmarRecepcionTransferenciaAction } from "@/app/(dashboard)/inventario/movimientos/actions";
import type { TransferenciaRemitoListado } from "@/lib/services/inventario/transferencia.service";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";

interface Props {
  transferencias: TransferenciaRemitoListado[];
  puedeConfirmar: boolean;
}

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

function EstadoRemitoBadge({ estado }: { estado: TransferenciaRemitoListado["estado"] }) {
  if (estado === "RECIBIDA") {
    return <Badge variant="secondary"><CheckCircle2 className="size-3.5" /> RECIBIDA</Badge>;
  }
  if (estado === "PARCIAL") {
    return (
      <Badge variant="outline" className="border-amber-500 bg-amber-50 text-amber-700">
        <PackageCheck className="size-3.5" /> PARCIAL
      </Badge>
    );
  }
  return <Badge variant="outline"><Truck className="size-3.5" /> EN_TRANSITO</Badge>;
}

export function RecepcionesPendientesPanel({ transferencias, puedeConfirmar }: Props) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});
  const [cantidadesPorRemito, setCantidadesPorRemito] = useState<Record<string, Record<string, number>>>({});
  const [pending, startTransition] = useTransition();

  function alternarExpandido(remitoId: string) {
    setExpandidos((prev) => ({ ...prev, [remitoId]: !prev[remitoId] }));
  }

  function actualizarCantidad(remitoId: string, itemId: string, cantidad: number, maximo: number) {
    const clamped = Math.min(Math.max(0, Math.trunc(cantidad) || 0), maximo);
    setCantidadesPorRemito((prev) => ({
      ...prev,
      [remitoId]: { ...prev[remitoId], [itemId]: clamped },
    }));
  }

  function confirmar(remito: TransferenciaRemitoListado) {
    const cantidades = cantidadesPorRemito[remito.id] ?? {};
    const items = Object.entries(cantidades)
      .filter(([, cantidad]) => cantidad > 0)
      .map(([transferencia_item_id, cantidad_recibida]) => ({ transferencia_item_id, cantidad_recibida }));

    if (items.length === 0) {
      toast.add({ title: "Marcá al menos un ítem con cantidad a recibir", type: "warning" });
      return;
    }

    startTransition(async () => {
      const resultado = await confirmarRecepcionTransferenciaAction({ transferencia_id: remito.id, items });
      if (!resultado.success) {
        toast.add({ title: "No se pudo confirmar la recepción", description: resultado.error?.message ?? "Error inesperado", type: "error" });
        return;
      }
      toast.add({ title: "Recepción confirmada", description: "El stock ya está disponible en destino.", type: "success" });
      setCantidadesPorRemito((prev) => ({ ...prev, [remito.id]: {} }));
      router.refresh();
    });
  }

  const pendientes = transferencias;
  const termino = busqueda.trim().toLocaleLowerCase("es");
  const filtrados = termino
    ? pendientes.filter((remito) =>
        [remito.numero_remito, remito.deposito_origen, remito.deposito_destino, ...remito.items.flatMap((item) => [item.sku, item.producto_nombre])]
          .some((valor) => valor.toLocaleLowerCase("es").includes(termino)),
      )
    : pendientes;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / 10));
  const paginaValida = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice((paginaValida - 1) * 10, paginaValida * 10);

  return (
    <section className="space-y-5" aria-labelledby="recepciones-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="recepciones-title" className="text-xl font-bold text-gray-900">Recepciones pendientes</h2>
          <p className="text-sm text-muted-foreground">El stock despachado queda fuera de la disponibilidad comercial hasta confirmar su recepción.</p>
        </div>
        <Link href="/inventario/movimientos/historial-transferencias" className={buttonVariants({ variant: "outline" })}>
          <History className="size-4" /> Historial de Transferencias
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Remitos pendientes</CardTitle><CardDescription>Mercadería despachada que todavía no integra el disponible del destino.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={busqueda}
              onChange={(event) => { setBusqueda(event.target.value); setPagina(1); }}
              placeholder="Buscar por remito, SKU, producto o depósito"
              aria-label="Buscar remitos pendientes"
              className="pl-9"
            />
          </div>
          <TablaTransferencias
            items={visibles}
            puedeConfirmar={puedeConfirmar}
            pending={pending}
            expandidos={expandidos}
            cantidadesPorRemito={cantidadesPorRemito}
            onToggleExpandido={alternarExpandido}
            onActualizarCantidad={actualizarCantidad}
            onConfirmar={confirmar}
            emptyMessage={termino ? "No hay remitos que coincidan con la búsqueda." : "No hay remitos pendientes."}
          />
          {filtrados.length > 0 && (
            <Paginacion
              pagina={paginaValida}
              totalPaginas={totalPaginas}
              total={filtrados.length}
              onAnterior={() => setPagina(Math.max(1, paginaValida - 1))}
              onSiguiente={() => setPagina(Math.min(totalPaginas, paginaValida + 1))}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function TablaTransferencias({
  items,
  puedeConfirmar,
  pending,
  expandidos,
  cantidadesPorRemito,
  onToggleExpandido,
  onActualizarCantidad,
  onConfirmar,
  emptyMessage,
}: {
  items: TransferenciaRemitoListado[];
  puedeConfirmar: boolean;
  pending: boolean;
  expandidos: Record<string, boolean>;
  cantidadesPorRemito: Record<string, Record<string, number>>;
  onToggleExpandido: (remitoId: string) => void;
  onActualizarCantidad: (remitoId: string, itemId: string, cantidad: number, maximo: number) => void;
  onConfirmar: (remito: TransferenciaRemitoListado) => void;
  emptyMessage: string;
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead /><TableHead>Remito</TableHead><TableHead>Ítems</TableHead><TableHead>Ruta</TableHead><TableHead>Cantidad</TableHead><TableHead>Estado</TableHead><TableHead>Fecha</TableHead>{puedeConfirmar && <TableHead />}</TableRow></TableHeader>
      <TableBody>{items.map((remito) => {
        const expandido = expandidos[remito.id] ?? false;
        return (
          <Fragment key={remito.id}>
            <TableRow>
              <TableCell>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => onToggleExpandido(remito.id)} aria-label={expandido ? "Contraer ítems" : "Expandir ítems"}>
                  {expandido ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </Button>
              </TableCell>
              <TableCell className="font-medium">{remito.numero_remito}</TableCell>
              <TableCell>{remito.items_count} ítem{remito.items_count === 1 ? "" : "s"}</TableCell>
              <TableCell>{remito.deposito_origen} <ArrowRight className="mx-1 inline size-3" /> {remito.deposito_destino}</TableCell>
              <TableCell>{remito.cantidad_total}</TableCell>
              <TableCell><EstadoRemitoBadge estado={remito.estado} /></TableCell>
              <TableCell>{formatearFechaHora(remito.recibida_at ?? remito.despachada_at)}</TableCell>
              {puedeConfirmar && (
                <TableCell>
                  <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => onConfirmar(remito)} disabled={pending}>
                    <PackageCheck className="size-4" /> Confirmar recepción
                  </Button>
                </TableCell>
              )}
            </TableRow>
            {expandido && (
              <TableRow>
                <TableCell />
                <TableCell colSpan={puedeConfirmar ? 6 : 5} className="bg-muted/30">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU / Producto</TableHead>
                        <TableHead className="text-right">Enviado</TableHead>
                        <TableHead className="text-right">Recibido</TableHead>
                        <TableHead>Estado ítem</TableHead>
                        {puedeConfirmar && <TableHead className="text-right">A recibir ahora</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {remito.items.map((item) => {
                        const pendiente = item.cantidad - item.cantidad_recibida;
                        const valorActual = cantidadesPorRemito[remito.id]?.[item.id] ?? 0;
                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              <span className="block font-mono text-xs">{item.sku}</span>
                              <span className="text-xs text-muted-foreground">{item.producto_nombre}</span>
                            </TableCell>
                            <TableCell className="text-right">{item.cantidad}</TableCell>
                            <TableCell className="text-right">{item.cantidad_recibida}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={item.estado_item === "RECIBIDO_TOTAL" ? "border-emerald-400 text-emerald-700" : item.estado_item === "RECIBIDO_PARCIAL" ? "border-amber-400 text-amber-700" : ""}>
                                {item.estado_item.replaceAll("_", " ")}
                              </Badge>
                            </TableCell>
                            {puedeConfirmar && (
                              <TableCell className="text-right">
                                {pendiente > 0 ? (
                                  <Input
                                    type="number"
                                    min={0}
                                    max={pendiente}
                                    value={valorActual}
                                    onChange={(e) => onActualizarCantidad(remito.id, item.id, Number(e.target.value), pendiente)}
                                    className="ml-auto h-8 w-20"
                                    aria-label={`Cantidad a recibir de ${item.producto_nombre}`}
                                  />
                                ) : (
                                  <span className="text-xs text-muted-foreground">completo</span>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        );
      })}</TableBody>
    </Table>
  );
}

function Paginacion({ pagina, totalPaginas, total, onAnterior, onSiguiente }: {
  pagina: number;
  totalPaginas: number;
  total: number;
  onAnterior: () => void;
  onSiguiente: () => void;
}) {
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
