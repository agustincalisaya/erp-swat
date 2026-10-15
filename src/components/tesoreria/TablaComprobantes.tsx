/**
 * @component TablaComprobantes
 * @description HU-G3 (spec_modulo_G.md §9.5) — tabla paginada del repositorio
 * de comprobantes fiscales. Server Component presentacional, mismo patrón que
 * `TablaAuditLog`: paginación con links (sin JS). Solo lectura: el número
 * abre la vista de detalle y la única acción es descargar el PDF (G3-3); no
 * hay edición ni baja (G3-5).
 *
 * "Vinculado" sale de `comprobante_original` / `notas_credito`, que el
 * servicio resuelve por `comprobante_original_id` (G3-4), y cada número
 * linkea al detalle del comprobante relacionado. Los links al detalle
 * conservan filtros y página para que "Volver al listado" vuelva al mismo lugar.
 */
import Link from "next/link";
import { FileText } from "lucide-react";
import type { ComprobanteResumen, ListadoComprobantes } from "@/lib/services/tesoreria/comprobantes-repositorio.service";
import { formatearFechaNegocio } from "@/lib/utils/fecha-negocio";
import {
  enlacesVinculados,
  ETIQUETAS_CANAL_COMPROBANTE,
  ETIQUETAS_TIPO_COMPROBANTE,
  formatearTotalComprobante,
  hrefDetalleComprobante,
  hrefPdfComprobante,
} from "@/components/tesoreria/comprobantes-presentacion";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const claseLink = "underline-offset-4 hover:underline hover:text-primary focus-visible:underline";

function Vinculado({ comprobante, query }: { comprobante: ComprobanteResumen; query: string }) {
  const { original, notas_credito } = enlacesVinculados(comprobante, query);
  if (original) {
    return (
      <>
        Anula{" "}
        <Link href={original.href} className={`font-mono text-xs ${claseLink}`}>
          {original.numero}
        </Link>
      </>
    );
  }
  if (notas_credito.length === 0) return <>—</>;
  return (
    <>
      {notas_credito.map((nc, indice) => (
        <span key={nc.comprobante_id}>
          {indice > 0 && ", "}
          <Link href={nc.href} className={`font-mono text-xs ${claseLink}`}>
            {nc.numero}
          </Link>
        </span>
      ))}
    </>
  );
}

const claseEncabezado = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

interface TablaComprobantesProps {
  resultado: ListadoComprobantes;
  /** Query string de los filtros activos (sin `page`), para no perderlos al paginar. */
  queryBase: string;
}

export function TablaComprobantes({ resultado, queryBase }: TablaComprobantesProps) {
  const { registros, total, page, page_size } = resultado;
  const totalPaginas = Math.max(1, Math.ceil(total / page_size));
  const queryDetalle = new URLSearchParams(queryBase);
  if (page > 1) queryDetalle.set("page", String(page));
  const query = queryDetalle.toString();

  if (registros.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed border-border bg-selected/40 text-center">
        <div className="p-4 rounded-full bg-selected text-selected-foreground mb-4">
          <FileText className="size-8" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No hay comprobantes con esos filtros.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className={claseEncabezado}>Número</TableHead>
              <TableHead className={claseEncabezado}>Tipo</TableHead>
              <TableHead className={claseEncabezado}>Canal</TableHead>
              <TableHead className={claseEncabezado}>Cliente</TableHead>
              <TableHead className={claseEncabezado}>Emisión</TableHead>
              <TableHead className={`${claseEncabezado} text-right`}>Total</TableHead>
              <TableHead className={claseEncabezado}>Vinculado</TableHead>
              <TableHead className={`${claseEncabezado} text-right`}>PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registros.map((c) => (
              <TableRow key={c.comprobante_id} className="hover:bg-accent">
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  <Link href={hrefDetalleComprobante(c.comprobante_id, query)} className={claseLink}>
                    {c.numero}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{ETIQUETAS_TIPO_COMPROBANTE[c.tipo_comprobante]}</TableCell>
                <TableCell>{ETIQUETAS_CANAL_COMPROBANTE[c.canal]}</TableCell>
                <TableCell>
                  {c.cliente.nombre}
                  {c.cliente.dni && <span className="text-muted-foreground"> · {c.cliente.dni}</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatearFechaNegocio(c.fecha_emision)}</TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">{formatearTotalComprobante(c)}</TableCell>
                <TableCell className="text-muted-foreground">
                  <Vinculado comprobante={c} query={query} />
                </TableCell>
                <TableCell className="text-right">
                  <a
                    href={hrefPdfComprobante(c.comprobante_id, "attachment")}
                    aria-label="Descargar PDF"
                    title={`Descargar PDF de ${c.numero}`}
                    className={buttonVariants({ variant: "outline", size: "icon-sm" })}
                  >
                    <FileText className="size-4" aria-hidden="true" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
        <span>
          Página {page} de {totalPaginas} — {total} comprobante{total === 1 ? "" : "s"} en total
        </span>
        <div className="flex gap-2">
          <PaginaLink page={page - 1} disabled={page <= 1} label="Anterior" queryBase={queryBase} />
          <PaginaLink page={page + 1} disabled={page >= totalPaginas} label="Siguiente" queryBase={queryBase} />
        </div>
      </div>
    </div>
  );
}

function PaginaLink({ page, disabled, label, queryBase }: { page: number; disabled: boolean; label: string; queryBase: string }) {
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
