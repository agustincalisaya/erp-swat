import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { diaDeVigencia, formatearFechaNegocio } from "@/lib/utils/fecha-negocio";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cargarReporteMensual } from "@/lib/services/tesoreria/reporte-mensual.pantalla";
import { interpretarMesReporte } from "@/lib/services/tesoreria/reporte-mensual.periodo";
import { PERMISO_LEER_DESGLOSE_GASTOS, PERMISO_LEER_REPORTES } from "@/lib/services/tesoreria/reporte-mensual.service";
import type { DetalleMovimientoMensualDto } from "@/lib/services/tesoreria/reporte-mensual.detalle.types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reporte mensual — ERP SWAT" };

function dinero(valor: string) {
  const signo = valor.startsWith("-") ? "−" : "";
  const [entero, centavos] = (signo ? valor.slice(1) : valor).split(".");
  return `${signo}$ ${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}
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

export default async function ReporteMensualPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!await usuarioTienePermiso(session.userId, PERMISO_LEER_REPORTES)) redirect("/no-autorizado");
  const query = await searchParams;
  const seleccionado = typeof query.mes === "string" ? query.mes : Array.isArray(query.mes) ? "" : undefined;
  const periodo = interpretarMesReporte(seleccionado);
  const desglose = await usuarioTienePermiso(session.userId, PERMISO_LEER_DESGLOSE_GASTOS);
  let reporte: Awaited<ReturnType<typeof cargarReporteMensual>> | null = null;
  if (periodo) {
    try {
      reporte = await cargarReporteMensual(periodo.anio, periodo.mes, { incluir_desglose_gastos: desglose });
    } catch {
      // El error técnico no se envía al navegador.
    }
  }
  const resumen = reporte?.resumen;
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Reporte mensual</h1>
          <p className="text-sm text-muted-foreground">Ingresos y egresos de caja por mes de Argentina.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium" htmlFor="mes-reporte">
            Mes
            <input id="mes-reporte" name="mes" type="month" defaultValue={periodo?.mesIso ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3" required />
          </label>
          <Button type="submit">Consultar</Button>
        </form>
        {!periodo ? (
          <p role="alert" className="rounded-md border border-destructive p-4 text-sm">Seleccioná un mes válido.</p>
        ) : !reporte || !resumen ? (
          <p role="alert" className="rounded-md border border-destructive p-4 text-sm">
            No se pudo cargar el reporte. Intentá nuevamente.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Ingresos", resumen.ingresos.total],
                ["Egresos", resumen.egresos.total],
                ["Resultado neto", resumen.resultado_neto],
              ].map(([titulo, valor]) => (
                <Card key={titulo}><CardHeader><CardTitle className="text-sm">{titulo}</CardTitle></CardHeader>
                  <CardContent className="text-xl font-semibold">{dinero(valor)}</CardContent></Card>
              ))}
              <Card><CardHeader><CardTitle className="text-sm">Egresos sobre ingresos</CardTitle></CardHeader>
                <CardContent className="text-xl font-semibold">
                  {resumen.porcentaje_egresos_sobre_ingresos === null
                    ? "—" : porcentaje(resumen.porcentaje_egresos_sobre_ingresos)}
                </CardContent></Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle>Ingresos</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
                <p className="flex justify-between"><span>Web</span><strong>{dinero(resumen.ingresos.web)}</strong></p>
                <p className="flex justify-between"><span>Reintegros web</span><strong>− {dinero(resumen.ingresos.reintegros_web)}</strong></p>
                <p className="flex justify-between"><span>Mostrador</span><strong>{dinero(resumen.ingresos.mostrador)}</strong></p>
                <p className="flex justify-between border-t pt-2"><span>Cuenta corriente (informativa)</span>
                  <strong>{dinero(resumen.ventas_cuenta_corriente_informativo)}</strong></p>
              </CardContent></Card>
              <Card><CardHeader><CardTitle>Egresos</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
                <p className="flex justify-between"><span>Proveedores</span><strong>{dinero(resumen.egresos.proveedores)}</strong></p>
                <p className="flex justify-between"><span>Gastos operativos</span><strong>{dinero(resumen.egresos.gastos_operativos)}</strong></p>
              </CardContent></Card>
            </div>
            <Card><CardHeader><CardTitle>Mostrador por medio</CardTitle></CardHeader><CardContent>
              {resumen.ingresos.mostrador_por_medio.length === 0 ? <p className="text-sm text-muted-foreground">Sin cobros de mostrador.</p> :
                <Table><TableHeader><TableRow><TableHead>Medio</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
                  <TableBody>{resumen.ingresos.mostrador_por_medio.map((fila) =>
                    <TableRow key={fila.medio}><TableCell>{fila.medio.replaceAll("_", " ")}</TableCell>
                      <TableCell className="text-right">{dinero(fila.importe)}</TableCell></TableRow>)}</TableBody></Table>}
            </CardContent></Card>
            {resumen.egresos.gastos_por_categoria !== null && (
              <Card><CardHeader><CardTitle>Gastos por categoría</CardTitle></CardHeader><CardContent>
                {resumen.egresos.gastos_por_categoria.length === 0 ? <p className="text-sm text-muted-foreground">Sin gastos operativos.</p> :
                  <Table><TableHeader><TableRow><TableHead>Categoría</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
                    <TableBody>{resumen.egresos.gastos_por_categoria.map((fila) =>
                      <TableRow key={fila.categoria_gasto_id}><TableCell>{fila.nombre}{!fila.activa && " (inactiva)"}</TableCell>
                        <TableCell className="text-right">{dinero(fila.importe)}</TableCell></TableRow>)}</TableBody></Table>}
              </CardContent></Card>
            )}
            <Card><CardHeader><CardTitle>Detalle de movimientos</CardTitle>
              <CardDescription>Ordenado por fecha e identificador de origen.</CardDescription></CardHeader><CardContent>
              {reporte.detalle.length === 0 ? <p className="text-sm text-muted-foreground">Sin movimientos en este mes.</p> :
                <Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Origen</TableHead>
                  <TableHead>Concepto</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
                  <TableBody>{reporte.detalle.map((fila) =>
                    <TableRow key={fila.id}><TableCell>{fechaFila(fila)}</TableCell><TableCell>{ETIQUETAS[fila.tipo]}</TableCell>
                      <TableCell>{fila.concepto}</TableCell><TableCell>{fila.impacta_resultado ? "En caja" : <Badge variant="secondary">Informativo</Badge>}</TableCell>
                      <TableCell className="text-right">{dinero(fila.importe)}</TableCell></TableRow>)}</TableBody></Table>}
            </CardContent></Card>
            {!reporte.adicionalesDisponibles && (
              <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
                El análisis adicional no está disponible en este momento.
              </p>
            )}
            {reporte.bloques.filter((bloque) =>
              bloque.clave === "egresos_por_proveedor" || bloque.clave === "comparacion_mes_anterior").map((bloque) =>
              <Card key={bloque.clave}><CardHeader><CardTitle>{bloque.titulo}</CardTitle></CardHeader><CardContent>
                {bloque.filas.length === 0 ? <p className="text-sm text-muted-foreground">Sin filas para este mes.</p> :
                  <Table><TableHeader><TableRow>{bloque.columnas.map((columna, i) =>
                    <TableHead key={i}>{columna}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>{bloque.filas.map((fila, i) =>
                      <TableRow key={i}>{fila.map((celda, j) => <TableCell key={j}>{celda}</TableCell>)}</TableRow>)}</TableBody></Table>}
              </CardContent></Card>)}
            <p className="text-xs text-muted-foreground">
              La fecha de facturación aproxima la fecha de cobro de mostrador. Los gastos se muestran por su monto total, sin separación de IVA.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
