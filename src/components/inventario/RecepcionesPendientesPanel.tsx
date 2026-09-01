"use client";

/**
 * @component RecepcionesPendientesPanel
 * @description HU-A11 — reubicación de "confirmar recepción" tras el
 * borrado de la ex `TransferenciasPanel.tsx` (HU-A4): es la única
 * funcionalidad de ese panel que no tenía otro hogar en el wizard nuevo (el
 * despacho de transferencias pasó a `wizard/PasoTransferencia.tsx`). Invoca
 * `confirmarRecepcionTransferenciaAction` (`movimientos/actions.ts`) sin
 * modificarla.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, History, PackageCheck, Search, Truck } from "lucide-react";

import { confirmarRecepcionTransferenciaAction } from "@/app/(dashboard)/inventario/movimientos/actions";
import type { TransferenciaListado } from "@/lib/services/inventario/transferencia.service";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";

interface Props {
  transferencias: TransferenciaListado[];
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

export function RecepcionesPendientesPanel({ transferencias, puedeConfirmar }: Props) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [pending, startTransition] = useTransition();

  function confirmar(id: string) {
    startTransition(async () => {
      const resultado = await confirmarRecepcionTransferenciaAction(id);
      if (!resultado.success) {
        toast.add({ title: "No se pudo confirmar la recepción", description: resultado.error?.message ?? "Error inesperado", type: "error" });
        return;
      }
      toast.add({ title: "Recepción confirmada", description: "El stock ya está disponible en destino.", type: "success" });
      router.refresh();
    });
  }

  const pendientes = transferencias.filter((item) => item.estado === "EN_TRANSITO");
  const termino = busqueda.trim().toLocaleLowerCase("es");
  const filtrados = termino
    ? pendientes.filter((item) => [item.numero_remito, item.sku, item.producto_nombre, item.deposito_origen, item.deposito_destino]
        .some((valor) => valor.toLocaleLowerCase("es").includes(termino)))
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

function TablaTransferencias({ items, puedeConfirmar, pending, onConfirmar, emptyMessage }: {
  items: TransferenciaListado[];
  puedeConfirmar: boolean;
  pending: boolean;
  onConfirmar: (id: string) => void;
  emptyMessage: string;
}) {
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
