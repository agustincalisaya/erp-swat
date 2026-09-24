"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ResponsableAuditoriaCliente } from "@/lib/services/clientes/auditoria-clientes.service";

export function FiltrosAuditoriaClientes({ responsables }: { responsables: ResponsableAuditoriaCliente[] }) {
  const router = useRouter();
  const paramsActuales = useSearchParams();
  const [clienteNombre, setClienteNombre] = useState(paramsActuales.get("cliente_nombre") ?? "");
  const [usuarioId, setUsuarioId] = useState(paramsActuales.get("usuario_id") ?? "");
  const [accion, setAccion] = useState(paramsActuales.get("accion") ?? "");
  const [fechaDesde, setFechaDesde] = useState(paramsActuales.get("fecha_desde") ?? "");
  const [fechaHasta, setFechaHasta] = useState(paramsActuales.get("fecha_hasta") ?? "");

  function aplicar(evento: React.FormEvent) {
    evento.preventDefault();
    const params = new URLSearchParams({ modulo: "clientes", page: "1" });
    if (clienteNombre.trim()) params.set("cliente_nombre", clienteNombre.trim());
    if (usuarioId) params.set("usuario_id", usuarioId);
    if (accion) params.set("accion", accion);
    if (fechaDesde) params.set("fecha_desde", fechaDesde);
    if (fechaHasta) params.set("fecha_hasta", fechaHasta);
    if (paramsActuales.get("page_size")) params.set("page_size", paramsActuales.get("page_size")!);
    router.push(`/auditoria/logs?${params.toString()}`);
  }

  function limpiar() {
    setClienteNombre(""); setUsuarioId(""); setAccion(""); setFechaDesde(""); setFechaHasta("");
    router.push("/auditoria/logs?modulo=clientes");
  }

  return (
    <form onSubmit={aplicar} className="rounded-xl border border-border bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
      <div className="space-y-1.5">
        <Label htmlFor="auditoria-cliente-nombre" className="text-xs">Cliente</Label>
        <Input id="auditoria-cliente-nombre" type="search" value={clienteNombre}
          onChange={(e) => setClienteNombre(e.target.value)} placeholder="Nombre completo o parcial" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="auditoria-cliente-responsable" className="text-xs">Usuario responsable</Label>
        <select id="auditoria-cliente-responsable" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
          <option value="">Todos</option>
          {responsables.map((responsable) => <option key={responsable.id} value={responsable.id}>{responsable.nombre_completo}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="auditoria-cliente-accion" className="text-xs">Operación</Label>
        <select id="auditoria-cliente-accion" value={accion} onChange={(e) => setAccion(e.target.value)}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
          <option value="">Todas</option>
          <option value="CREATE">Alta</option>
          <option value="UPDATE">Modificación</option>
          <option value="DELETE_LOGICO">Baja lógica</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="auditoria-cliente-desde" className="text-xs">Desde</Label>
        <Input id="auditoria-cliente-desde" type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="auditoria-cliente-hasta" className="text-xs">Hasta</Label>
        <Input id="auditoria-cliente-hasta" type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"><Filter className="size-3.5" />Filtrar</Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={limpiar}><X className="size-3.5" />Limpiar</Button>
      </div>
    </form>
  );
}
