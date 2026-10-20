import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { diaDeVigencia, diaNegocioIso, formatearFechaNegocio } from "@/lib/utils/fecha-negocio";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cargarReporteMensual } from "@/lib/services/tesoreria/reporte-mensual.pantalla";
import { interpretarMesReporte } from "@/lib/services/tesoreria/reporte-mensual.periodo";
import { dineroReporte, nombreMesReporte } from "@/lib/services/tesoreria/reporte-mensual.presentacion";
import { PERMISO_LEER_DESGLOSE_GASTOS, PERMISO_LEER_REPORTES } from "@/lib/services/tesoreria/reporte-mensual.service";
import type { DetalleMovimientoMensualDto } from "@/lib/services/tesoreria/reporte-mensual.detalle.types";
import { obtenerSerieSeisMeses } from "@/lib/services/tesoreria/reporte-mensual.serie.service";
import { proyectarSerieVisual } from "@/lib/services/tesoreria/reporte-mensual.graficos.datos";
import { GraficoSerieSeisMeses } from "@/components/tesoreria/reporte-mensual.graficos";
import { PERMISO_EXPORTAR_REPORTES } from "@/lib/services/tesoreria/reporte-mensual.export.service";
import { CategoriasVisualMensual, ProveedoresVisualMensual, ResumenVisualMensual } from "@/components/tesoreria/reporte-mensual.resumen";
import type { PuntoVisual } from "@/lib/services/tesoreria/reporte-mensual.graficos.datos";
import type { BloqueReporte } from "@/lib/services/tesoreria/reporte-mensual.types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reporte mensual — ERP SWAT" };

function porcentaje(valor: number) {
  const [entero, decimal = "0"] = String(valor).split(".");
  return `${entero},${decimal} %`;
}
function fechaFila(fila: DetalleMovimientoMensualDto) {
  if (fila.tipo === "GASTO_OPERATIVO") {
    const [anio, mes, dia] = fila.fecha.slice(0, 10).split("-");
    return `${dia}/${mes}/${anio}`;
  }
  if (fila.tipo === "EGRESO_PROVEEDOR") {
    const [anio, mes, dia] = diaDeVigencia(new Date(fila.fecha)).split("-");
    return `${dia}/${mes}/${anio}`;
  }
  return formatearFechaNegocio(fila.fecha);
}
const ETIQUETAS = {
  COBRO_WEB: "Cobro web", REINTEGRO_WEB: "Reintegro web",
  VENTA_MOSTRADOR: "Venta mostrador", EGRESO_PROVEEDOR: "Pago proveedor",
  GASTO_OPERATIVO: "Gasto operativo",
} as const;

function BloqueAdicionalCard({ bloque }: { bloque: BloqueReporte }) {
  return <Card className="min-w-0 gap-3"><CardHeader><CardTitle className="text-base">{bloque.titulo}</CardTitle></CardHeader><CardContent className="min-w-0">
    {bloque.filas.length === 0 ? <p className="text-sm text-muted-foreground">Sin filas para este mes.</p> :
      <div className="overflow-x-auto"><Table className="min-w-[520px]"><TableHeader><TableRow>{bloque.columnas.map((columna, i) =>
        <TableHead key={i} className={i > 0 ? "text-right" : ""}>{columna}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{bloque.filas.map((fila, i) =>
          <TableRow key={i}>{fila.map((celda, j) => <TableCell key={j} className={j > 0 ? "text-right tabular-nums" : "font-medium"}>{celda}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
  </CardContent></Card>;
}

export default async function ReporteMensualPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!await usuarioTienePermiso(session.userId, PERMISO_LEER_REPORTES)) redirect("/no-autorizado");
  const query = await searchParams;
  const seleccionado = typeof query.mes === "string" ? query.mes : Array.isArray(query.mes) ? "" : undefined;
  const ahora = new Date();
  const mesActual = diaNegocioIso(ahora).slice(0, 7);
  const periodo = interpretarMesReporte(seleccionado, ahora);
  const desglose = await usuarioTienePermiso(session.userId, PERMISO_LEER_DESGLOSE_GASTOS);
  const puedeExportar = await usuarioTienePermiso(session.userId, PERMISO_EXPORTAR_REPORTES);
  let reporte: Awaited<ReturnType<typeof cargarReporteMensual>> | null = null;
  let serie: PuntoVisual[] | null = null;
  if (periodo) {
    try {
      reporte = await cargarReporteMensual(periodo.anio, periodo.mes, { incluir_desglose_gastos: desglose });
      try {
        serie = proyectarSerieVisual(await obtenerSerieSeisMeses(reporte.resumen));
      } catch {
        // El gráfico no invalida el reporte principal.
      }
    } catch {
      // El error técnico no se envía al navegador.
    }
  }
  const resumen = reporte?.resumen;
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Reporte mensual</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">Ingresos y egresos del mes, base caja. Ingresos de la web y del mostrador. Egresos de proveedores pagados y gastos operativos.</p>
          </div>
          {puedeExportar && periodo && reporte && <div className="flex flex-wrap gap-2">
            <a className={buttonVariants({ variant: "outline" })} href={`/api/tesoreria/reporte-mensual/exportar/csv?mes=${periodo.mesIso}`}>Exportar CSV</a>
            <a className={buttonVariants({ variant: "outline" })} href={`/api/tesoreria/reporte-mensual/exportar/pdf?mes=${periodo.mesIso}`}>Exportar PDF</a>
          </div>}
        </header>
        <div className="flex flex-wrap items-end gap-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm text-muted-foreground sm:flex sm:items-center sm:gap-2" htmlFor="mes-reporte">
              Mes
              <input id="mes-reporte" name="mes" type="month" defaultValue={periodo?.mesIso ?? mesActual} max={mesActual}
                className="h-9 min-w-48 rounded-md border border-input bg-card px-3 text-foreground" required />
            </label>
            <Button type="submit" variant="outline">Consultar</Button>
          </form>
          {periodo && <p className="pb-1 text-sm font-medium">{nombreMesReporte(periodo.mesIso)}</p>}
        </div>
        {!periodo ? (
          <p role="alert" className="rounded-md border border-destructive p-4 text-sm">Seleccioná un mes válido.</p>
        ) : !reporte || !resumen ? (
          <p role="alert" className="rounded-md border border-destructive p-4 text-sm">
            No se pudo cargar el reporte. Intentá nuevamente.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="gap-2"><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Ingresos</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{dineroReporte(resumen.ingresos.total)}</CardContent></Card>
              <Card className="gap-2"><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Egresos</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums text-rose-700 dark:text-rose-400">{dineroReporte(resumen.egresos.total)}</CardContent></Card>
              <Card className="gap-2"><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Resultado neto</CardTitle></CardHeader>
                <CardContent className={`text-2xl font-semibold tabular-nums ${resumen.resultado_neto.startsWith("-") ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{dineroReporte(resumen.resultado_neto)}</CardContent></Card>
              <Card className="gap-2"><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Egresos sobre ingresos</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold tabular-nums">
                  {resumen.porcentaje_egresos_sobre_ingresos === null
                    ? "—" : porcentaje(resumen.porcentaje_egresos_sobre_ingresos)}
                </CardContent></Card>
            </div>
            {serie ? <GraficoSerieSeisMeses serie={serie} />
              : <p role="status" className="text-sm text-muted-foreground">Los gráficos no están disponibles en este momento.</p>}
            <ResumenVisualMensual resumen={resumen} detalle={reporte.detalle} mes={periodo.mesIso} />
            {!reporte.adicionalesDisponibles && (
              <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
                El análisis adicional no está disponible en este momento.
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <ProveedoresVisualMensual detalle={reporte.detalle} total={resumen.egresos.proveedores} mes={periodo.mesIso} />
              <CategoriasVisualMensual resumen={resumen} detalle={reporte.detalle} mes={periodo.mesIso} />
            </div>
            {reporte.bloques.filter((bloque) => bloque.clave !== "egresos_por_proveedor").map((bloque) => <BloqueAdicionalCard key={bloque.clave} bloque={bloque} />)}
            <aside className="rounded-xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
              <p className="font-semibold">Ventas de mostrador en cuenta corriente: <span className="tabular-nums">{dineroReporte(resumen.ventas_cuenta_corriente_informativo)}</span></p>
              <p className="mt-1 text-sky-800 dark:text-sky-200">Informativo, fuera de los totales: medios de pago de mostrador con cuenta corriente, por fecha de facturación.</p>
            </aside>
            <Card><CardHeader><CardTitle>Detalle de movimientos del mes</CardTitle>
              <CardDescription>Ordenado por fecha e identificador de origen.</CardDescription></CardHeader><CardContent>
              {reporte.detalle.length === 0 ? <p className="text-sm text-muted-foreground">Sin movimientos en este mes.</p> :
                <Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Concepto</TableHead>
                  <TableHead className="hidden text-muted-foreground md:table-cell">Origen</TableHead><TableHead className="hidden text-muted-foreground lg:table-cell">Estado</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
                  <TableBody>{reporte.detalle.map((fila) =>
                    <TableRow key={fila.id}><TableCell className="whitespace-nowrap text-muted-foreground">{fechaFila(fila)}</TableCell>
                      <TableCell className="font-medium">{fila.concepto}</TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{ETIQUETAS[fila.tipo]}</TableCell>
                      <TableCell className="hidden lg:table-cell">{fila.impacta_resultado ? "En caja" : <Badge variant="secondary">Informativo</Badge>}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${fila.importe.startsWith("-") ? "text-rose-700 dark:text-rose-400" : ""}`}>{dineroReporte(fila.importe)}</TableCell></TableRow>)}</TableBody></Table>}
            </CardContent></Card>
            <p className="text-xs text-muted-foreground">Montos tal como están registrados, sin discriminar IVA. Mes en hora Argentina.</p>
          </>
        )}
      </div>
    </main>
  );
}
