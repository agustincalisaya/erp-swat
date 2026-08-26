"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, Search, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  remitoInicial: string;
  desdeInicial?: string;
  hastaInicial?: string;
}

const RUTA_HISTORIAL = "/inventario/movimientos/historial-transferencias";

export function FiltrosHistorialTransferencias({ remitoInicial, desdeInicial, hastaInicial }: Props) {
  const router = useRouter();
  const [remito, setRemito] = useState(remitoInicial);
  const [desde, setDesde] = useState(desdeInicial ?? "");
  const [hasta, setHasta] = useState(hastaInicial ?? "");
  const [error, setError] = useState<string | null>(null);

  function aplicarFiltros(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (desde && hasta && desde > hasta) {
      setError("La fecha Desde no puede ser posterior a Hasta.");
      return;
    }
    setError(null);
    const params = new URLSearchParams();
    if (remito.trim()) params.set("remito", remito.trim());
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    params.set("page", "1");
    router.push(`${RUTA_HISTORIAL}?${params.toString()}`);
  }

  function limpiarFiltros() {
    setRemito("");
    setDesde("");
    setHasta("");
    setError(null);
    router.push(RUTA_HISTORIAL);
  }

  return (
    <form onSubmit={aplicarFiltros} className="space-y-3 rounded-xl border bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_auto_auto_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="historial-remito">Remito</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="historial-remito" value={remito} onChange={(event) => setRemito(event.target.value)} placeholder="Buscar por número de remito" className="pl-9" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="historial-desde">Desde</Label>
          <Input id="historial-desde" type="date" value={desde} onChange={(event) => { setDesde(event.target.value); setError(null); }} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="historial-hasta">Hasta</Label>
          <Input id="historial-hasta" type="date" value={hasta} min={desde || undefined} onChange={(event) => { setHasta(event.target.value); setError(null); }} />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit"><Filter className="size-4" /> Filtrar</Button>
          <Button type="button" variant="outline" onClick={limpiarFiltros}><X className="size-4" /> Limpiar</Button>
        </div>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </form>
  );
}
