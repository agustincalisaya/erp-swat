"use client";

/**
 * @component FiltrosHistorialPropio
 * @description Filtros de "Mi historial" (HU-D8, spec_modulo_D.md §8.1):
 * rango de días (hora de Argentina, ambos días completos) y tipo de acción.
 * Los filtros viven en la URL; el Server Component (`page.tsx`) vuelve a
 * consultar con los nuevos valores.
 *
 * No hay filtro de usuario (D8-7): la vista propia nunca busca por otros
 * usuarios. `acciones` llega del servidor y contiene solo las acciones que el
 * propio usuario tiene registradas (D8-4).
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RUTA = "/auditoria/mi-historial";

interface FiltrosHistorialPropioProps {
  /** DISTINCT de acciones del propio usuario (`listarAccionesPropias`). */
  acciones: string[];
}

export function FiltrosHistorialPropio({ acciones }: FiltrosHistorialPropioProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [fechaDesde, setFechaDesde] = useState(searchParams.get("fecha_desde") ?? "");
  const [fechaHasta, setFechaHasta] = useState(searchParams.get("fecha_hasta") ?? "");
  const [accion, setAccion] = useState(searchParams.get("accion") ?? "");

  const aplicarFiltros = (e: React.FormEvent) => {
    e.preventDefault();

    const params = new URLSearchParams();
    if (fechaDesde) params.set("fecha_desde", fechaDesde);
    if (fechaHasta) params.set("fecha_hasta", fechaHasta);
    if (accion) params.set("accion", accion);
    // Cambiar filtros reinicia la paginación.
    params.set("page", "1");

    router.push(`${RUTA}?${params.toString()}`);
  };

  const limpiarFiltros = () => {
    setFechaDesde("");
    setFechaHasta("");
    setAccion("");
    router.push(RUTA);
  };

  return (
    <form
      onSubmit={aplicarFiltros}
      className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
    >
      <div className="space-y-1.5">
        <Label htmlFor="historial-fecha-desde" className="text-xs">
          Desde
        </Label>
        <Input
          id="historial-fecha-desde"
          type="date"
          value={fechaDesde}
          max={fechaHasta || undefined}
          onChange={(e) => setFechaDesde(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="historial-fecha-hasta" className="text-xs">
          Hasta
        </Label>
        <Input
          id="historial-fecha-hasta"
          type="date"
          value={fechaHasta}
          min={fechaDesde || undefined}
          onChange={(e) => setFechaHasta(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="historial-accion" className="text-xs">
          Acción
        </Label>
        <select
          id="historial-accion"
          value={accion}
          onChange={(e) => setAccion(e.target.value)}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Todas</option>
          {acciones.map((valorAccion) => (
            <option key={valorAccion} value={valorAccion}>
              {valorAccion}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" className="gap-1.5 bg-primary hover:bg-primary-hover text-primary-foreground">
          <Filter className="size-3.5" aria-hidden="true" />
          Filtrar
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={limpiarFiltros}>
          <X className="size-3.5" aria-hidden="true" />
          Limpiar
        </Button>
      </div>
    </form>
  );
}
