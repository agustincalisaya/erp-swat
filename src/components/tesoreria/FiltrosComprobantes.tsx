"use client";

/**
 * @component FiltrosComprobantes
 * @description HU-G3 (spec_modulo_G.md §9.5, G3-2) — filtros combinables del
 * repositorio de comprobantes fiscales. Mismo patrón que `FiltrosAuditoria`:
 * los filtros viven en la URL y el Server Component vuelve a consultar el
 * servicio. Cambiar filtros reinicia la paginación.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RUTA = "/tesoreria/comprobantes";

const TIPOS = [
  { valor: "FACTURA_A", etiqueta: "Factura A" },
  { valor: "FACTURA_B", etiqueta: "Factura B" },
  { valor: "TICKET", etiqueta: "Ticket" },
  { valor: "NOTA_CREDITO", etiqueta: "Nota de Crédito" },
] as const;

const CANALES = [
  { valor: "MOSTRADOR", etiqueta: "Mostrador" },
  { valor: "WEB", etiqueta: "Web" },
] as const;

const claseSelect =
  "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function FiltrosComprobantes() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cliente, setCliente] = useState(searchParams.get("cliente") ?? "");
  const [tipo, setTipo] = useState(searchParams.get("tipo") ?? "");
  const [canal, setCanal] = useState(searchParams.get("canal") ?? "");
  const [fechaDesde, setFechaDesde] = useState(searchParams.get("fecha_desde") ?? "");
  const [fechaHasta, setFechaHasta] = useState(searchParams.get("fecha_hasta") ?? "");

  const aplicarFiltros = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (cliente.trim()) params.set("cliente", cliente.trim());
    if (tipo) params.set("tipo", tipo);
    if (canal) params.set("canal", canal);
    if (fechaDesde) params.set("fecha_desde", fechaDesde);
    if (fechaHasta) params.set("fecha_hasta", fechaHasta);
    params.set("page", "1");
    router.push(`${RUTA}?${params.toString()}`);
  };

  const limpiarFiltros = () => {
    setCliente("");
    setTipo("");
    setCanal("");
    setFechaDesde("");
    setFechaHasta("");
    router.push(RUTA);
  };

  return (
    <form
      onSubmit={aplicarFiltros}
      className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
    >
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
        <Label htmlFor="filtro-cliente" className="text-xs">
          Cliente (DNI o nombre)
        </Label>
        <Input
          id="filtro-cliente"
          value={cliente}
          maxLength={100}
          placeholder="Cliente (DNI o nombre)"
          onChange={(e) => setCliente(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filtro-tipo" className="text-xs">
          Tipo
        </Label>
        <select id="filtro-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={claseSelect}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filtro-canal" className="text-xs">
          Canal
        </Label>
        <select id="filtro-canal" value={canal} onChange={(e) => setCanal(e.target.value)} className={claseSelect}>
          <option value="">Todos los canales</option>
          {CANALES.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filtro-fecha-desde" className="text-xs">
          Emitidos desde
        </Label>
        <Input id="filtro-fecha-desde" type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filtro-fecha-hasta" className="text-xs">
          Emitidos hasta
        </Label>
        <Input id="filtro-fecha-hasta" type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
        <Button type="submit" size="sm" className="gap-1.5 bg-primary hover:bg-primary-hover text-primary-foreground">
          <Filter className="size-3.5" aria-hidden="true" />
          Filtrar
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={limpiarFiltros}>
          <X className="size-3.5" aria-hidden="true" />
          Limpiar
        </Button>
        <Badge className="bg-warning text-warning-foreground sm:ml-auto">Simulado · sin validez ante AFIP</Badge>
      </div>
    </form>
  );
}
