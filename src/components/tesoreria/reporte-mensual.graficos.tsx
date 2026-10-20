"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { BarraVisual, PuntoVisual } from "@/lib/services/tesoreria/reporte-mensual.graficos.datos";

const serieConfig = {
  ingresosVisual: { label: "Ingresos", color: "var(--chart-1)" },
  egresosVisual: { label: "Egresos", color: "var(--chart-2)" },
} satisfies ChartConfig;

const barrasConfig = { visual: { label: "Importe", color: "var(--chart-3)" } } satisfies ChartConfig;

function TablaBarras({ filas }: { filas: readonly BarraVisual[] }) {
  return <table className="w-full text-sm"><thead><tr><th className="text-left">Origen</th><th className="text-right">Importe ($)</th></tr></thead>
    <tbody>{filas.map((fila, i) => <tr key={`${fila.etiqueta}-${i}`}><td>{fila.etiqueta}</td><td className="text-right">{fila.texto}</td></tr>)}</tbody></table>;
}

function GraficoBarras({ filas, titulo }: { filas: readonly BarraVisual[]; titulo: string }) {
  return <section aria-label={titulo} className="space-y-3">
    <h3 className="font-medium">{titulo}</h3>
    <ChartContainer config={barrasConfig} className="h-64 w-full" role="img" aria-label={titulo}>
      <BarChart accessibilityLayer data={filas} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} /><XAxis dataKey="etiqueta" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={55} /><ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="visual" fill="var(--chart-3)" radius={3} />
      </BarChart>
    </ChartContainer>
    <TablaBarras filas={filas} />
  </section>;
}

export function GraficosReporteMensual({
  serie, ingresos, egresos,
}: { serie: readonly PuntoVisual[]; ingresos: readonly BarraVisual[]; egresos: readonly BarraVisual[] }) {
  return <div className="space-y-6">
    <section aria-label="Ingresos y egresos de los últimos seis meses" className="space-y-3">
      <h2 className="text-lg font-semibold">Últimos seis meses</h2>
      <ChartContainer config={serieConfig} className="h-72 w-full" role="img" aria-label="Barras de ingresos y egresos por mes">
        <BarChart accessibilityLayer data={serie} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} /><XAxis dataKey="periodo" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={55} /><ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip content={<ChartTooltipContent />} /><ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="ingresosVisual" fill="var(--chart-1)" radius={3} />
          <Bar dataKey="egresosVisual" fill="var(--chart-2)" radius={3} />
        </BarChart>
      </ChartContainer>
      <table className="w-full text-sm"><thead><tr><th className="text-left">Mes</th><th className="text-right">Ingresos ($)</th><th className="text-right">Egresos ($)</th></tr></thead>
        <tbody>{serie.map((punto) => <tr key={punto.periodo}><td>{punto.periodo}</td><td className="text-right">{punto.ingresosTexto}</td><td className="text-right">{punto.egresosTexto}</td></tr>)}</tbody></table>
    </section>
    <section className="space-y-4"><h2 className="text-lg font-semibold">Desglose del mes</h2>
      <div className="grid gap-6 lg:grid-cols-2"><GraficoBarras filas={ingresos} titulo="Ingresos por canal" />
        <GraficoBarras filas={egresos} titulo="Egresos por origen" /></div>
    </section>
  </div>;
}
