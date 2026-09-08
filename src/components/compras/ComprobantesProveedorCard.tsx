/**
 * @component ComprobantesProveedorCard
 * @description Card de "Comprobantes de proveedor" anidada en el detalle de una
 * Orden de Compra (HU-H9, spec_modulo_H.md §2.7 / §5). Server Component: recibe
 * la lista ya resuelta por `listarComprobantesPorOrdenCompra()` y los flags de
 * permiso calculados en el RSC de la página. Los sub-componentes interactivos
 * (`FormularioRegistrarComprobante`, `DialogAnularComprobante`) son client.
 *
 * Reglas de UI que reflejan el contrato del servicio:
 *  - El botón "Registrar comprobante" solo aparece si la OC está en
 *    RECIBIDA_COMPLETA o CERRADA y el usuario tiene
 *    `comprobantes_proveedor:crear`. El endpoint revalida igual.
 *  - "Anular" solo para comprobantes activos y usuarios con
 *    `comprobantes_proveedor:anular` (exclusivo Supervisor de Compras).
 *  - Un comprobante anulado se sigue mostrando (baja lógica) con su motivo.
 */

import { FileText } from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { FormularioRegistrarComprobante } from "@/components/compras/FormularioRegistrarComprobante";
import { DialogAnularComprobante } from "@/components/compras/DialogAnularComprobante";
import type { ComprobanteProveedorListado } from "@/lib/services/proveedores/comprobante-proveedor.service";

interface ComprobantesProveedorCardProps {
  ordenCompraId: string;
  numeroOrden: string;
  /** true si `OrdenCompra.estado` ∈ {RECIBIDA_COMPLETA, CERRADA}. */
  ordenAdmiteComprobante: boolean;
  comprobantes: ComprobanteProveedorListado[];
  puedeCrear: boolean;
  puedeAnular: boolean;
}

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

const TIPO_LABEL: Record<string, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
  FACTURA_M: "Factura M",
};

function formatFechaSolo(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(fecha));
}

export function ComprobantesProveedorCard({
  ordenCompraId,
  numeroOrden,
  ordenAdmiteComprobante,
  comprobantes,
  puedeCrear,
  puedeAnular,
}: ComprobantesProveedorCardProps) {
  const mostrarBotonRegistrar = ordenAdmiteComprobante && puedeCrear;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-blue-500" aria-hidden="true" />
              Comprobantes de proveedor
            </CardTitle>
            <CardDescription>
              Comprobantes fiscales (Factura A/B/C/M) que el proveedor envió como
              respaldo de esta orden. Carga manual — inmutables una vez creados.
            </CardDescription>
          </div>
          {mostrarBotonRegistrar && (
            <div className="shrink-0">
              <FormularioRegistrarComprobante
                ordenCompraId={ordenCompraId}
                numeroOrden={numeroOrden}
              />
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {!ordenAdmiteComprobante && comprobantes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            La orden todavía no está RECIBIDA_COMPLETA ni CERRADA — no admite la
            carga de comprobantes.
          </p>
        ) : comprobantes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Sin comprobantes registrados para esta orden.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    Tipo
                  </th>
                  <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    Número
                  </th>
                  <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    Emisión
                  </th>
                  <th className="text-right py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    Monto total
                  </th>
                  <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    Registrado por
                  </th>
                  <th className="text-left py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    Estado
                  </th>
                  <th className="py-3" aria-hidden="true" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {comprobantes.map((c) => (
                  <tr key={c.id} className={c.is_active ? "" : "opacity-60"}>
                    <td className="py-3">{TIPO_LABEL[c.tipo] ?? c.tipo}</td>
                    <td className="py-3 font-mono text-xs">
                      {c.numero_comprobante}
                      {c.archivo_adjunto_url && (
                        <a
                          href={c.archivo_adjunto_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-blue-600 underline"
                        >
                          adjunto
                        </a>
                      )}
                    </td>
                    <td className="py-3 tabular-nums">
                      {formatFechaSolo(c.fecha_emision)}
                    </td>
                    <td className="py-3 text-right tabular-nums font-medium">
                      {money.format(Number(c.monto_total))}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {c.registrado_por_nombre ?? "—"}
                    </td>
                    <td className="py-3">
                      {c.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Activo
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                          title={c.deletion_reason ?? undefined}
                        >
                          Anulado
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {c.is_active && puedeAnular && (
                        <DialogAnularComprobante
                          comprobanteId={c.id}
                          ordenCompraId={ordenCompraId}
                          descripcionComprobante={`${TIPO_LABEL[c.tipo] ?? c.tipo} N.° ${c.numero_comprobante}`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
