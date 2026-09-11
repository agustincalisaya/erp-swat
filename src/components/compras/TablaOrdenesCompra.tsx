"use client";

/**
 * @component TablaOrdenesCompra
 * @description Grilla de órdenes de compra (HU-H3) con filtros server-side
 * por estado y por proveedor, sincronizados con la URL (mismo patrón que
 * `TablaForenseInventario` — el filtro escribe query params y el RSC padre
 * re-consulta). Cada fila navega al detalle de la orden.
 *
 * Solo lectura: no expone acciones de mutación. El alta se dispara desde el
 * botón "Nueva orden de compra" de la página, y la cancelación vive en el
 * detalle.
 */

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, ClipboardList, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { EstadoOrdenCompraBadge } from "@/components/compras/EstadoOrdenCompraBadge";
import { ESTADOS_ORDEN_COMPRA } from "@/lib/schemas/ordenes-compra.schema";
import type {
  OrdenCompraResumen,
  ProveedorParaSelector,
} from "@/lib/services/proveedores/orden-compra.service";

interface TablaOrdenesCompraProps {
  ordenes: OrdenCompraResumen[];
  proveedores: ProveedorParaSelector[];
  filtrosIniciales: {
    estado?: string;
    proveedor_id?: string;
  };
}

const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: "Borrador",
  ENVIADA: "Enviada",
  CONFIRMADA: "Confirmada",
  RECEPCION_PARCIAL: "Recepción parcial",
  RECIBIDA_COMPLETA: "Recibida completa",
  CERRADA: "Cerrada",
  CANCELADA: "Cancelada",
};

/** Sentinel "sin filtro" para el combo de proveedor. */
const TODOS_LOS_PROVEEDORES: ProveedorParaSelector = {
  id: "",
  razon_social: "Todos los proveedores",
  nombre_fantasia: null,
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(fecha));
}

export function TablaOrdenesCompra({
  ordenes,
  proveedores,
  filtrosIniciales,
}: TablaOrdenesCompraProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const estadoActual = filtrosIniciales.estado ?? "";
  const proveedorActual = filtrosIniciales.proveedor_id ?? "";

  const aplicarFiltro = useCallback(
    (clave: "estado" | "proveedor_id", valor: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (valor) {
        params.set(clave, valor);
      } else {
        params.delete(clave);
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const limpiarFiltros = () => router.push("?");
  const hayFiltros = Boolean(estadoActual || proveedorActual);

  return (
    <div className="space-y-4">
      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Filter className="size-3.5" />
          Filtros
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="filtro-estado-oc" className="text-xs">
              Estado
            </Label>
            <select
              id="filtro-estado-oc"
              value={estadoActual}
              onChange={(e) => aplicarFiltro("estado", e.target.value)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">Todos los estados</option>
              {ESTADOS_ORDEN_COMPRA.map((estado) => (
                <option key={estado} value={estado}>
                  {ESTADO_LABEL[estado] ?? estado}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="filtro-proveedor-oc" className="text-xs">
              Proveedor
            </Label>
            <ComboboxFiltrable
              id="filtro-proveedor-oc"
              items={[TODOS_LOS_PROVEEDORES, ...proveedores]}
              getId={(p) => p.id}
              getLabel={(p) => p.razon_social}
              value={proveedorActual}
              onChange={(p) => aplicarFiltro("proveedor_id", p.id)}
              placeholder="Todos los proveedores"
              pageSize={8}
            />
          </div>
        </div>

        {hayFiltros && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={limpiarFiltros}
              className="text-xs h-7 text-muted-foreground hover:text-foreground"
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {ordenes.length} orden(es)
      </p>

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  N.º de orden
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Proveedor
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Estado
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Emisión
                </th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Ítems
                </th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ordenes.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground text-sm"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="size-8 text-muted-foreground/50" />
                      No hay órdenes de compra que coincidan con los filtros.
                    </div>
                  </td>
                </tr>
              ) : (
                ordenes.map((orden) => (
                  <tr
                    key={orden.id}
                    onClick={() => router.push(`/compras/ordenes/${orden.id}`)}
                    className="hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold">
                      {orden.numero_orden}
                    </td>
                    <td className="px-4 py-3">{orden.proveedor_razon_social}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EstadoOrdenCompraBadge estado={orden.estado} />
                        {orden.entrega_vencida && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                            title="La fecha de entrega comprometida venció y la orden todavía no se recibió por completo"
                          >
                            <AlertTriangle className="size-3" aria-hidden="true" />
                            Entrega vencida
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatFecha(orden.fecha_emision)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {orden.cantidad_items}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {money.format(orden.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
