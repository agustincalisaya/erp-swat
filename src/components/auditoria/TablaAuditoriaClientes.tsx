import Link from "next/link";
import type { ListadoAuditoriaClientes } from "@/lib/services/clientes/auditoria-clientes.service";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const ETIQUETA_OPERACION = { CREATE: "Alta", UPDATE: "Modificación", DELETE_LOGICO: "Baja lógica" } as const;

function fechaHora(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(fecha));
}

export function TablaAuditoriaClientes({ resultado, queryBase }: { resultado: ListadoAuditoriaClientes; queryBase: string }) {
  const { registros, total, page, page_size } = resultado;
  const totalPaginas = Math.max(1, Math.ceil(total / page_size));
  if (!registros.length) return <p className="py-12 text-center text-sm text-muted-foreground">No hay asientos de clientes para los filtros aplicados.</p>;

  const hrefPagina = (numero: number) => `/auditoria/logs?${queryBase}&page=${numero}`;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha y hora</TableHead><TableHead>Responsable</TableHead><TableHead>Cliente</TableHead>
            <TableHead>Operación</TableHead><TableHead>Motivo registrado</TableHead><TableHead>Cambios registrados</TableHead>
          </TableRow></TableHeader>
          <TableBody>{registros.map((registro) => (
            <TableRow key={registro.id}>
              <TableCell className="whitespace-nowrap text-xs">{fechaHora(registro.created_at)}</TableCell>
              <TableCell className="text-xs">
                <div>{registro.usuario_nombre ?? "—"}</div>
                <div className="font-mono text-muted-foreground">{registro.usuario_id ?? "sistema"}</div>
              </TableCell>
              <TableCell className="text-xs">
                {registro.cliente_id ? <Link className="text-blue-600 hover:underline" href={`/clientes/${registro.cliente_id}`}>
                  {registro.cliente_nombre_actual ?? registro.cliente_id}
                </Link> : "—"}
                {registro.cliente_nombre_actual && <div className="text-muted-foreground">Nombre y DNI actuales: {registro.cliente_dni_actual}</div>}
                {registro.cliente_nombre_actual && <div className="font-mono text-muted-foreground">{registro.cliente_id}</div>}
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap">{ETIQUETA_OPERACION[registro.accion]}</TableCell>
              <TableCell className="text-xs">{registro.motivo ?? "—"}</TableCell>
              <TableCell className="text-xs">
                {registro.valor_anterior !== null || registro.valor_nuevo !== null ? <details>
                  <summary className="cursor-pointer text-blue-600">Ver valores</summary>
                  <pre className="mt-1 max-w-sm overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
                    {JSON.stringify({ anterior: registro.valor_anterior, nuevo: registro.valor_nuevo }, null, 2)}
                  </pre>
                </details> : "—"}
              </TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Página {page} de {totalPaginas} — {total} asiento{total === 1 ? "" : "s"}</span>
        <div className="flex gap-2">
          {page > 1 ? <Link className="rounded border px-3 py-1.5" href={hrefPagina(page - 1)}>Anterior</Link> : <span className="rounded border px-3 py-1.5 opacity-50">Anterior</span>}
          {page < totalPaginas ? <Link className="rounded border px-3 py-1.5" href={hrefPagina(page + 1)}>Siguiente</Link> : <span className="rounded border px-3 py-1.5 opacity-50">Siguiente</span>}
        </div>
      </div>
    </div>
  );
}
