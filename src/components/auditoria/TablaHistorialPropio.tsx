/**
 * @component TablaHistorialPropio
 * @description Tabla paginada de "Mi historial" (HU-D8, spec_modulo_D.md
 * §8.1). Server Component presentacional; la paginación son links que
 * actualizan `page` sin JS.
 *
 * Columnas fijas: fecha y hora (Argentina), acción, entidad e ID de registro
 * (decisión C4). No muestra usuario, IP ni detalle anterior/nuevo (D8-6): el
 * servicio tampoco los lee de la base.
 */
import { History } from "lucide-react";
import type { ListadoHistorialPropio } from "@/lib/services/auditoria/audit-log.service";
import { formatearFechaHoraNegocio } from "@/lib/utils/fecha-negocio";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface TablaHistorialPropioProps {
  resultado: ListadoHistorialPropio;
  /** Query string de los filtros activos (sin `page`). */
  queryBase: string;
}

const CLASE_ENCABEZADO = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export function TablaHistorialPropio({ resultado, queryBase }: TablaHistorialPropioProps) {
  const { registros, total, page, page_size } = resultado;
  const totalPaginas = Math.max(1, Math.ceil(total / page_size));

  return (
    <div className="space-y-4">
      {registros.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed border-border bg-selected/40 text-center">
          <div className="p-4 rounded-full bg-selected text-selected-foreground mb-4">
            <History className="size-8" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No hay acciones registradas</p>
          <p className="text-xs text-muted-foreground mt-1">
            No hay acciones registradas para los filtros elegidos.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className={CLASE_ENCABEZADO}>Fecha y hora</TableHead>
                <TableHead className={CLASE_ENCABEZADO}>Acción</TableHead>
                <TableHead className={CLASE_ENCABEZADO}>Entidad</TableHead>
                <TableHead className={`hidden sm:table-cell ${CLASE_ENCABEZADO}`}>ID de registro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registros.map((registro) => (
                <TableRow key={registro.id} className="hover:bg-accent">
                  <TableCell>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatearFechaHoraNegocio(registro.created_at)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-info text-info-foreground border border-info-foreground hover:bg-info">
                      {registro.accion}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{registro.tabla_afectada}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span
                      className="block max-w-[14rem] truncate text-[11px] text-muted-foreground font-mono"
                      title={registro.registro_id ?? undefined}
                    >
                      {registro.registro_id ?? "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Paginación (links, sin JS) ───────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
        <span>
          Página {page} de {totalPaginas} — {total} registro{total === 1 ? "" : "s"} en total
        </span>
        <div className="flex gap-2">
          <PaginaLink page={page - 1} disabled={page <= 1} label="Anterior" queryBase={queryBase} />
          <PaginaLink page={page + 1} disabled={page >= totalPaginas} label="Siguiente" queryBase={queryBase} />
        </div>
      </div>
    </div>
  );
}

function PaginaLink({
  page,
  disabled,
  label,
  queryBase,
}: {
  page: number;
  disabled: boolean;
  label: string;
  queryBase: string;
}) {
  if (disabled) {
    return (
      <span className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground/50 cursor-not-allowed">
        {label}
      </span>
    );
  }

  const separador = queryBase ? "&" : "";

  return (
    <a
      href={`?${queryBase}${separador}page=${page}`}
      className="px-3 py-1.5 rounded-lg border border-border hover:bg-accent hover:border-border hover:text-primary"
    >
      {label}
    </a>
  );
}
