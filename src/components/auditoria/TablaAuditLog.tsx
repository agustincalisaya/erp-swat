/**
 * @component TablaAuditLog
 * @description Tabla paginada de resultados de `listarAuditLog()`
 * (task_cali_auditoria_forense.md §5). Server Component puramente
 * presentacional — sin interactividad propia; la paginación se resuelve
 * con links que actualizan el query param `page` (sin JS necesario).
 *
 * `valor_anterior`/`valor_nuevo` solo se muestran si `mostrarDetalle` es
 * `true` (el service ya los omite del resultado sin el permiso ampliado —
 * este componente además nunca los renderiza si no vinieron, doble barrera).
 */
import { ScrollText } from "lucide-react";
import type { ListadoAuditLog } from "@/lib/services/auditoria/audit-log.service";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { limpiarNombreUsuario } from "@/lib/utils/nombre-usuario";

function formatFechaHora(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

interface TablaAuditLogProps {
  resultado: ListadoAuditLog;
  mostrarDetalle: boolean;
  /** Query string de los filtros activos (sin `page`), para que los links
   *  de paginación no pierdan fecha/tabla/acción/usuario ya aplicados. */
  queryBase: string;
}

export function TablaAuditLog({ resultado, mostrarDetalle, queryBase }: TablaAuditLogProps) {
  const { registros, total, page, page_size } = resultado;
  const totalPaginas = Math.max(1, Math.ceil(total / page_size));

  if (registros.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed border-blue-100 bg-blue-50/40 text-center">
        <div className="p-4 rounded-full bg-blue-100 text-blue-500 mb-4">
          <ScrollText className="size-8" />
        </div>
        <p className="text-sm font-medium text-gray-600">No hay registros</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ningún evento coincide con los filtros aplicados.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fecha
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Usuario
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Acción
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tabla afectada
              </TableHead>
              <TableHead className="hidden md:table-cell text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                IP
              </TableHead>
              {mostrarDetalle && (
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Detalle
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {registros.map((registro) => (
              <TableRow key={registro.id} className="hover:bg-blue-50/30">
                <TableCell>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatFechaHora(registro.created_at)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold">
                      {registro.usuario_nombre
                        ? limpiarNombreUsuario(registro.usuario_nombre)
                        : "—"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {registro.usuario_id ?? "sistema"}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className="bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-100">
                    {registro.accion}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{registro.tabla_afectada}</span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="text-xs text-muted-foreground font-mono">{registro.ip}</span>
                </TableCell>
                {mostrarDetalle && (
                  <TableCell>
                    {registro.valor_nuevo || registro.valor_anterior ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-blue-600 hover:underline">
                          Ver
                        </summary>
                        <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
                          {JSON.stringify(
                            { anterior: registro.valor_anterior, nuevo: registro.valor_nuevo },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">—</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Paginación (links, sin JS) ───────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Página {page} de {totalPaginas} — {total} registro{total === 1 ? "" : "s"} en total
        </span>
        <div className="flex gap-2">
          <PaginaLink page={page - 1} disabled={page <= 1} label="Anterior" queryBase={queryBase} />
          <PaginaLink
            page={page + 1}
            disabled={page >= totalPaginas}
            label="Siguiente"
            queryBase={queryBase}
          />
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
      className="px-3 py-1.5 rounded-lg border border-border hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700"
    >
      {label}
    </a>
  );
}
