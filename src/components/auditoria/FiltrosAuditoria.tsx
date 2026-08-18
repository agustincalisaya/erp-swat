"use client";

/**
 * @component FiltrosAuditoria
 * @description Formulario de filtros para la Consola de Auditoría Forense
 * (task_cali_auditoria_forense.md §5). Los filtros viven en la URL (search
 * params) — al enviarlos, navega a la misma ruta con los query params
 * actualizados, y el Server Component (`page.tsx`) vuelve a llamar
 * `listarAuditLog()` con los nuevos valores.
 *
 * `usuario_id` solo se muestra si `mostrarFiltroUsuario` es `true` — un
 * usuario sin `auditoria:leer_forense` no tiene forma de ver ese campo en
 * la UI, aunque igualmente el service lo ignoraría si lo mandara por URL
 * a mano (regla de segregación ya aplicada server-side).
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TABLAS_CONOCIDAS = ["usuarios", "sesiones"];

interface FiltrosAuditoriaProps {
  mostrarFiltroUsuario: boolean;
}

export function FiltrosAuditoria({ mostrarFiltroUsuario }: FiltrosAuditoriaProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [fechaDesde, setFechaDesde] = useState(searchParams.get("fecha_desde") ?? "");
  const [fechaHasta, setFechaHasta] = useState(searchParams.get("fecha_hasta") ?? "");
  const [tablaAfectada, setTablaAfectada] = useState(searchParams.get("tabla_afectada") ?? "");
  const [accion, setAccion] = useState(searchParams.get("accion") ?? "");
  const [usuarioId, setUsuarioId] = useState(searchParams.get("usuario_id") ?? "");

  const aplicarFiltros = (e: React.FormEvent) => {
    e.preventDefault();

    const params = new URLSearchParams();
    if (fechaDesde) params.set("fecha_desde", fechaDesde);
    if (fechaHasta) params.set("fecha_hasta", fechaHasta);
    if (tablaAfectada) params.set("tabla_afectada", tablaAfectada);
    if (accion) params.set("accion", accion);
    if (mostrarFiltroUsuario && usuarioId) params.set("usuario_id", usuarioId);
    // Cambiar filtros reinicia la paginación — evita quedar en una página
    // que ya no existe para el nuevo resultado filtrado.
    params.set("page", "1");

    router.push(`/auditoria/logs?${params.toString()}`);
  };

  const limpiarFiltros = () => {
    setFechaDesde("");
    setFechaHasta("");
    setTablaAfectada("");
    setAccion("");
    setUsuarioId("");
    router.push("/auditoria/logs");
  };

  return (
    <form
      onSubmit={aplicarFiltros}
      className="rounded-xl border border-border bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
    >
      <div className="space-y-1.5">
        <Label htmlFor="filtro-fecha-desde" className="text-xs">
          Desde
        </Label>
        <Input
          id="filtro-fecha-desde"
          type="date"
          value={fechaDesde}
          onChange={(e) => setFechaDesde(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filtro-fecha-hasta" className="text-xs">
          Hasta
        </Label>
        <Input
          id="filtro-fecha-hasta"
          type="date"
          value={fechaHasta}
          onChange={(e) => setFechaHasta(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filtro-tabla" className="text-xs">
          Tabla afectada
        </Label>
        <select
          id="filtro-tabla"
          value={tablaAfectada}
          onChange={(e) => setTablaAfectada(e.target.value)}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Todas</option>
          {TABLAS_CONOCIDAS.map((tabla) => (
            <option key={tabla} value={tabla}>
              {tabla}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filtro-accion" className="text-xs">
          Acción
        </Label>
        <Input
          id="filtro-accion"
          placeholder="Ej: CREATE"
          value={accion}
          onChange={(e) => setAccion(e.target.value)}
        />
      </div>

      {mostrarFiltroUsuario && (
        <div className="space-y-1.5">
          <Label htmlFor="filtro-usuario" className="text-xs">
            Usuario (UUID)
          </Label>
          <Input
            id="filtro-usuario"
            placeholder="usuario_id"
            value={usuarioId}
            onChange={(e) => setUsuarioId(e.target.value)}
          />
        </div>
      )}

      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
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
