"use client";

/**
 * @component HistorialMovimientos
 * @description HU-A11 (spec_modulo_A.md §2.10) — historial operativo de
 * `MovimientoStock`. Monta `TablaFiltroPaginada` (HU-A5-ampliada) sin
 * modificarlo, inyectándole el `cargarPagina` contra
 * `GET /api/inventario/movimientos/historial` y columnas con el shape propio
 * de este historial. Los filtros de depósito/tipo/fecha viven por fuera de
 * `TablaFiltroPaginada` (que solo resuelve búsqueda de texto + paginación) y
 * se le pasan vía `revalidarCuando` para resetear a página 1 al cambiar.
 */
import { useState } from "react";
import { Eye } from "lucide-react";

import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";
import type { MovimientoHistorialItem } from "@/lib/services/inventario/movimiento.service";
import { Badge } from "@/components/ui/badge";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { RangoFechasCalendario } from "@/components/inventario/RangoFechasCalendario";
import { DetalleMovimientoDialog } from "@/components/inventario/DetalleMovimientoDialog";
import {
  TablaFiltroPaginada,
  type ColumnaTabla,
  type ResultadoTabla,
} from "@/components/inventario/TablaFiltroPaginada";
import { Button } from "@/components/ui/button";

interface Props {
  depositos: DepositoActivo[];
}

interface OpcionFiltro {
  id: string;
  label: string;
}

const TODOS_LOS_DEPOSITOS: OpcionFiltro = { id: "", label: "Todos los depósitos" };
const TODOS_LOS_TIPOS: OpcionFiltro = { id: "", label: "Todos los tipos" };
const TIPOS_MOVIMIENTO: OpcionFiltro[] = [
  TODOS_LOS_TIPOS,
  { id: "INGRESO", label: "Ingreso" },
  { id: "EGRESO", label: "Egreso" },
  { id: "TRANSFERENCIA", label: "Transferencia" },
  { id: "AJUSTE", label: "Ajuste" },
];

const fechaHoraFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Salta",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatearFechaHora(iso: string): string {
  return fechaHoraFormatter.format(new Date(iso));
}

export function HistorialMovimientos({ depositos }: Props) {
  const [depositoId, setDepositoId] = useState("");
  const [tipoMovimiento, setTipoMovimiento] = useState("");
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(undefined);
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(undefined);
  const [detalle, setDetalle] = useState<MovimientoHistorialItem | null>(null);

  const opcionesDeposito: OpcionFiltro[] = [
    TODOS_LOS_DEPOSITOS,
    ...depositos.map((d) => ({ id: d.id, label: d.nombre })),
  ];

  async function cargarPagina({
    busqueda,
    pagina,
    porPagina,
  }: {
    busqueda: string;
    pagina: number;
    porPagina: number;
  }): Promise<ResultadoTabla<MovimientoHistorialItem>> {
    const params = new URLSearchParams({
      pagina: String(pagina),
      por_pagina: String(porPagina),
    });
    if (busqueda) params.set("busqueda", busqueda);
    if (depositoId) params.set("deposito_id", depositoId);
    if (tipoMovimiento) params.set("tipo_movimiento", tipoMovimiento);
    if (fechaDesde) params.set("fecha_desde", fechaDesde);
    if (fechaHasta) params.set("fecha_hasta", fechaHasta);

    const respuesta = await fetch(`/api/inventario/movimientos/historial?${params.toString()}`);
    const json = await respuesta.json();
    if (!respuesta.ok || json.error) {
      throw new Error(json.error?.message ?? "No se pudo cargar el historial");
    }
    return json.data;
  }

  const columnas: ColumnaTabla<MovimientoHistorialItem>[] = [
    {
      clave: "productos",
      encabezado: "Producto(s)",
      // HU-A11 (multi-ítem): una fila ahora puede tener N ítems — se resume
      // como "N productos" en vez de mostrar un SKU singular (igual que
      // "Cantidad" pasa a ser la suma de todos los ítems del movimiento).
      render: (m) => (
        <div>
          <span className="block font-medium">{m.items_count} producto{m.items_count === 1 ? "" : "s"}</span>
          {m.items_count === 1 && (
            <span className="text-xs text-muted-foreground">{m.items[0].producto_nombre}</span>
          )}
        </div>
      ),
    },
    {
      clave: "tipo",
      encabezado: "Tipo",
      render: (m) => <Badge variant="outline">{m.tipo_movimiento}</Badge>,
    },
    {
      clave: "ruta",
      encabezado: "Depósito",
      render: (m) => (
        <span>
          {m.deposito_origen ?? "—"}
          {m.deposito_destino ? ` → ${m.deposito_destino}` : ""}
        </span>
      ),
    },
    { clave: "cantidad", encabezado: "Cantidad", render: (m) => m.cantidad_total, alinear: "derecha" },
    { clave: "registrado_por", encabezado: "Registrado por", render: (m) => m.registrado_por },
    { clave: "fecha", encabezado: "Fecha", render: (m) => formatearFechaHora(m.created_at) },
    {
      clave: "detalle",
      encabezado: "",
      render: (m) => (
        <Button variant="ghost" size="icon-sm" onClick={() => setDetalle(m)} aria-label="Ver detalle">
          <Eye className="size-4" />
        </Button>
      ),
      alinear: "derecha",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ComboboxFiltrable
          items={opcionesDeposito}
          getId={(o) => o.id}
          getLabel={(o) => o.label}
          value={depositoId}
          onChange={(o) => setDepositoId(o.id)}
          placeholder="Filtrar por depósito"
        />
        <ComboboxFiltrable
          items={TIPOS_MOVIMIENTO}
          getId={(o) => o.id}
          getLabel={(o) => o.label}
          value={tipoMovimiento}
          onChange={(o) => setTipoMovimiento(o.id)}
          placeholder="Filtrar por tipo"
        />
        <RangoFechasCalendario
          desde={fechaDesde}
          hasta={fechaHasta}
          onChange={({ desde, hasta }) => { setFechaDesde(desde); setFechaHasta(hasta); }}
        />
      </div>

      <TablaFiltroPaginada
        columnas={columnas}
        obtenerClaveFila={(m) => m.movimiento_id}
        cargarPagina={cargarPagina}
        revalidarCuando={[depositoId, tipoMovimiento, fechaDesde, fechaHasta]}
        porPagina={10}
        busquedaPlaceholder="Buscar por SKU o producto…"
        mensajeVacio="No hay movimientos que coincidan con los filtros."
        etiquetaRegistros={{ singular: "movimiento", plural: "movimientos" }}
      />

      <DetalleMovimientoDialog movimiento={detalle} onOpenChange={(open) => { if (!open) setDetalle(null); }} />
    </div>
  );
}
