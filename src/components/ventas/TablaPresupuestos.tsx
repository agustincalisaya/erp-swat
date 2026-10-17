"use client";

/**
 * @component TablaPresupuestos
 * @description Listado de presupuestos (HU-B3, `/ventas/presupuestos`).
 * Sin columna "Acciones" — toda la fila navega al detalle, mismo patrón que
 * `TablaOrdenesCompra.tsx` (confirmado en el relevamiento: es el patrón que
 * corresponde cuando la única acción de la fila es "ver detalle", a
 * diferencia del patrón inline + menú "⋮" que usa `TablaProveedores.tsx`
 * para múltiples acciones condicionadas por estado/permiso).
 */

import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { EstadoPresupuestoBadge } from "@/components/ventas/EstadoPresupuestoBadge";
import type { PresupuestoResumen } from "@/lib/services/ventas/presupuesto.service";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

function formatFecha(fecha: Date | null): string {
  if (!fecha) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(fecha));
}

interface TablaPresupuestosProps {
  presupuestos: PresupuestoResumen[];
}

export function TablaPresupuestos({ presupuestos }: TablaPresupuestosProps) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{presupuestos.length} presupuesto(s)</p>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Cliente
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Estado
                </th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Vigencia hasta
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
              {presupuestos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="size-8 text-muted-foreground/50" />
                      Todavía no hay presupuestos cargados.
                    </div>
                  </td>
                </tr>
              ) : (
                presupuestos.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/ventas/presupuestos/${p.id}`)}
                    className="hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">{p.cliente_nombre}</td>
                    <td className="px-4 py-3">
                      <EstadoPresupuestoBadge estado={p.estado} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatFecha(p.vigencia_hasta)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.cantidad_items}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {money.format(p.total)}
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
