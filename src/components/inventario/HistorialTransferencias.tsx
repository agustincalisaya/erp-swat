import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { HistorialTransferenciasListado } from "@/lib/services/inventario/transferencia.service";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fechaHoraFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface Props {
  resultado: HistorialTransferenciasListado;
  queryBase: string;
  hayFiltros: boolean;
}

export function HistorialTransferencias({ resultado, queryBase, hayFiltros }: Props) {
  const totalPaginas = Math.max(1, Math.ceil(resultado.total / resultado.page_size));

  if (resultado.registros.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {hayFiltros ? "No hay transferencias recibidas que coincidan con los filtros." : "No hay transferencias recibidas."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader><TableRow><TableHead>Remito</TableHead><TableHead>SKU</TableHead><TableHead>Ruta</TableHead><TableHead>Cantidad</TableHead><TableHead>Estado</TableHead><TableHead>Fecha</TableHead></TableRow></TableHeader>
          <TableBody>{resultado.registros.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.numero_remito}</TableCell>
              <TableCell><span className="block">{item.sku}</span><span className="text-xs text-muted-foreground">{item.producto_nombre}</span></TableCell>
              <TableCell>{item.deposito_origen} <ArrowRight className="mx-1 inline size-3" /> {item.deposito_destino}</TableCell>
              <TableCell>{item.cantidad}</TableCell>
              <TableCell><Badge variant="secondary"><CheckCircle2 className="size-4" /> RECIBIDA</Badge></TableCell>
              <TableCell className="whitespace-nowrap">{fechaHoraFormatter.format(new Date(item.recibida_at ?? item.despachada_at))}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Página {resultado.page} de {totalPaginas} — {resultado.total} transferencia{resultado.total === 1 ? "" : "s"}</span>
        <div className="flex gap-2">
          <PaginaLink pagina={resultado.page - 1} disabled={resultado.page <= 1} queryBase={queryBase}>Anterior</PaginaLink>
          <PaginaLink pagina={resultado.page + 1} disabled={resultado.page >= totalPaginas} queryBase={queryBase}>Siguiente</PaginaLink>
        </div>
      </div>
    </div>
  );
}

function PaginaLink({ pagina, disabled, queryBase, children }: { pagina: number; disabled: boolean; queryBase: string; children: React.ReactNode }) {
  if (disabled) return <span className={buttonVariants({ variant: "outline", size: "sm", className: "pointer-events-none opacity-50" })}>{children}</span>;
  const params = new URLSearchParams(queryBase);
  params.set("page", String(pagina));
  return <Link href={`?${params.toString()}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{children}</Link>;
}
