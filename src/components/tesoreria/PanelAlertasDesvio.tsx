/**
 * @component PanelAlertasDesvio
 * @description HU-D6 (task_relos.md D12, D19) — pestañas Activas / Resueltas /
 * Todas, selector de nivel y tabla Nivel · Indicador · Referencia · Detalle ·
 * Estado · Desde. Solo presentación: las filas llegan ya reevaluadas y
 * formateadas por `obtenerPanelAlertas()`. Pestañas y paginación son enlaces
 * (los filtros viven en la URL). El nivel se lee por texto, no solo por color.
 */

import Link from "next/link";

import type { FiltrosPanelAlertas } from "@/lib/schemas/alertas-desvio.schema";
import type { FilaAlertaPanel, PanelAlertas } from "@/lib/services/alertas/alerta-desvio.panel.service";
import { hrefPanel } from "@/lib/services/alertas/alerta-desvio.presentacion";
import type { SeveridadAlerta } from "@/lib/services/alertas/alerta-desvio.reglas";
import { SelectorNivelAlertas } from "@/components/tesoreria/SelectorNivelAlertas";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Tokens semánticos de `globals.css` (claro y oscuro); el texto del nivel siempre se muestra. */
export const CLASE_SEVERIDAD: Record<SeveridadAlerta, string> = {
  CRITICA: "bg-danger-soft text-danger-soft-foreground",
  ADVERTENCIA: "bg-warning text-warning-foreground",
  INFORMATIVA: "bg-info text-info-foreground",
};

const PESTANAS: { estado: FiltrosPanelAlertas["estado"]; etiqueta: string }[] = [
  { estado: "activas", etiqueta: "Activas" },
  { estado: "resueltas", etiqueta: "Resueltas" },
  { estado: "todas", etiqueta: "Todas" },
];

const VACIO: Record<FiltrosPanelAlertas["estado"], string> = {
  activas: "No hay alertas activas.",
  resueltas: "No hay alertas resueltas.",
  todas: "Todavía no hay alertas.",
};

function FilaAlerta({ alerta }: { alerta: FilaAlertaPanel }) {
  return (
    <TableRow>
      <TableCell>
        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${CLASE_SEVERIDAD[alerta.severidad]}`}>
          {alerta.severidad_etiqueta}
        </span>
      </TableCell>
      <TableCell className="min-w-40 whitespace-normal">{alerta.indicador_etiqueta}</TableCell>
      <TableCell className="min-w-40 whitespace-normal font-medium text-foreground">{alerta.referencia}</TableCell>
      <TableCell className="min-w-36 whitespace-normal">
        {alerta.detalle}
        {alerta.estado === "ACTIVA" && !alerta.detalle_vigente && (
          <span className="block text-xs text-muted-foreground">Último valor guardado</span>
        )}
      </TableCell>
      <TableCell>
        <span className={alerta.estado === "ACTIVA" ? "font-medium text-foreground" : "text-muted-foreground"}>
          {alerta.estado_etiqueta}
        </span>
        {alerta.resuelta_texto && (
          <span className="block text-xs text-muted-foreground">el {alerta.resuelta_texto}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{alerta.desde_texto}</TableCell>
    </TableRow>
  );
}

interface PanelAlertasDesvioProps {
  panel: PanelAlertas;
  filtros: FiltrosPanelAlertas;
}

export function PanelAlertasDesvio({ panel, filtros }: PanelAlertasDesvioProps) {
  const { page, total_paginas, total } = panel.paginacion;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Estado de las alertas" className="flex gap-1 rounded-lg bg-muted p-1">
          {PESTANAS.map((p) => {
            const activa = p.estado === filtros.estado;
            return (
              <Link
                key={p.estado}
                href={hrefPanel(filtros, { estado: p.estado })}
                aria-current={activa ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  activa ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.etiqueta}
              </Link>
            );
          })}
        </nav>
        <SelectorNivelAlertas filtros={filtros} />
      </div>

      {panel.alertas.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {filtros.nivel ? "No hay alertas con ese nivel en esta pestaña." : VACIO[filtros.estado]}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nivel</TableHead>
              <TableHead>Indicador</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead>Detalle</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Desde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {panel.alertas.map((alerta) => (
              <FilaAlerta key={alerta.id} alerta={alerta} />
            ))}
          </TableBody>
        </Table>
      )}

      {total_paginas > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {total_paginas} · {total} alerta(s)
          </span>
          <div className="flex gap-3">
            {page > 1 && (
              <Link href={hrefPanel(filtros, { page: page - 1 })} className="text-primary hover:underline">
                Anterior
              </Link>
            )}
            {page < total_paginas && (
              <Link href={hrefPanel(filtros, { page: page + 1 })} className="text-primary hover:underline">
                Siguiente
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
