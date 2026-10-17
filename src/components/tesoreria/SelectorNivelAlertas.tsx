"use client";

/**
 * @component SelectorNivelAlertas
 * @description HU-D6 (D12) — selector «Todos los niveles / Crítica /
 * Advertencia / Informativa». El filtro vive en la URL: cambia la ruta con
 * `hrefPanel` (misma función pura que arma las pestañas) y el RSC relee.
 */

import { useId } from "react";
import { useRouter } from "next/navigation";

import type { FiltrosPanelAlertas } from "@/lib/schemas/alertas-desvio.schema";
import { hrefPanel } from "@/lib/services/alertas/alerta-desvio.presentacion";

const OPCIONES: { valor: "" | NonNullable<FiltrosPanelAlertas["nivel"]>; etiqueta: string }[] = [
  { valor: "", etiqueta: "Todos los niveles" },
  { valor: "critica", etiqueta: "Crítica" },
  { valor: "advertencia", etiqueta: "Advertencia" },
  { valor: "informativa", etiqueta: "Informativa" },
];

export function SelectorNivelAlertas({ filtros }: { filtros: Pick<FiltrosPanelAlertas, "estado" | "nivel"> }) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        Nivel
      </label>
      <select
        id={id}
        value={filtros.nivel ?? ""}
        onChange={(e) => {
          const valor = e.target.value as (typeof OPCIONES)[number]["valor"];
          router.push(hrefPanel(filtros, { nivel: valor === "" ? null : valor }));
        }}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {OPCIONES.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
    </div>
  );
}
