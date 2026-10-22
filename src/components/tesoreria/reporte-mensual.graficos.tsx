"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PuntoVisual } from "@/lib/services/tesoreria/reporte-mensual.graficos.datos";
import { dineroReporte, nombreMesReporte } from "@/lib/services/tesoreria/reporte-mensual.presentacion";

const serieConfig = {
  ingresosVisual: { label: "Ingresos", color: "var(--report-income)" },
  egresosVisual: { label: "Egresos", color: "var(--report-expense)" },
} satisfies ChartConfig;

const etiquetaMes = (periodo: string) => nombreMesReporte(periodo, true);

export function GraficoSerieSeisMeses({ serie }: { serie: readonly PuntoVisual[] }) {
  return (
    <Card aria-label="Ingresos y egresos de los últimos seis meses" className="min-w-0 gap-3">
      <CardHeader><CardTitle>Últimos seis meses</CardTitle><CardDescription>Ingresos y egresos registrados por mes.</CardDescription></CardHeader>
      <CardContent className="min-w-0 space-y-4">
      <div className="overflow-x-auto"><ChartContainer config={serieConfig} className="h-72 min-w-[520px] w-full" role="img" aria-label="Barras de ingresos y egresos por mes">
        <BarChart accessibilityLayer data={serie} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} /><XAxis dataKey="periodo" tickFormatter={etiquetaMes} tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={55} /><ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip content={<ChartTooltipContent
            labelFormatter={(periodo) => etiquetaMes(String(periodo))}
            formatter={(_valor, _nombre, item) => {
              const ingreso = item.dataKey === "ingresosVisual";
              const punto = item.payload as PuntoVisual;
              return <div className="flex w-full min-w-44 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: ingreso ? "var(--report-income)" : "var(--report-expense)" }} />
                <span className="text-muted-foreground">{ingreso ? "Ingresos" : "Egresos"}</span>
                <span className="ml-auto font-medium tabular-nums text-foreground">{dineroReporte(ingreso ? punto.ingresosTexto : punto.egresosTexto)}</span>
              </div>;
            }}
          />} /><ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="ingresosVisual" name="Ingresos" fill="var(--report-income)" radius={3} />
          <Bar dataKey="egresosVisual" name="Egresos" fill="var(--report-expense)" radius={3} />
        </BarChart>
      </ChartContainer></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-2 text-left font-medium">Mes</th><th className="py-2 text-right font-medium">Ingresos ($)</th><th className="py-2 text-right font-medium">Egresos ($)</th></tr></thead>
        <tbody>{serie.map((punto) => <tr className="border-b last:border-0" key={punto.periodo}><td className="py-1.5">{etiquetaMes(punto.periodo)}</td><td className="py-1.5 text-right tabular-nums">{punto.ingresosTexto}</td><td className="py-1.5 text-right tabular-nums">{punto.egresosTexto}</td></tr>)}</tbody></table></div>
      </CardContent>
    </Card>
  );
}
