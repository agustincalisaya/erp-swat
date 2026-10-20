import type { ResumenMensualDto } from "./reporte-mensual.types";
import type { PuntoSerieReporte } from "./reporte-mensual.serie.service";

export interface BarraVisual {
  etiqueta: string;
  texto: string;
  visual: number;
}

export interface PuntoVisual {
  periodo: string;
  ingresosTexto: string;
  egresosTexto: string;
  ingresosVisual: number;
  egresosVisual: number;
}

/** Conversión exclusivamente geométrica; ninguna salida financiera usa estos números. */
function visual(importe: string): number {
  if (!/^-?\d+\.\d{2}$/.test(importe)) throw new RangeError("Importe visual inválido");
  const valor = Number(importe);
  if (!Number.isFinite(valor)) throw new RangeError("Importe visual no finito");
  return valor;
}

export function proyectarSerieVisual(puntos: readonly PuntoSerieReporte[]): PuntoVisual[] {
  return puntos.map(({ periodo, ingresos, egresos }) => ({
    periodo, ingresosTexto: ingresos, egresosTexto: egresos,
    ingresosVisual: visual(ingresos), egresosVisual: visual(egresos),
  }));
}

export function proyectarDesgloseVisual(resumen: ResumenMensualDto) {
  const barra = (etiqueta: string, texto: string): BarraVisual => ({ etiqueta, texto, visual: visual(texto) });
  const ingresos = [
    barra("Web", resumen.ingresos.web),
    { ...barra("Reintegros web (restan)", resumen.ingresos.reintegros_web),
      visual: -visual(resumen.ingresos.reintegros_web) },
    ...resumen.ingresos.mostrador_por_medio.map((fila) => barra(`Mostrador · ${fila.medio.replaceAll("_", " ")}`, fila.importe)),
  ];
  const egresos = [barra("Proveedores", resumen.egresos.proveedores)];
  if (resumen.egresos.gastos_por_categoria === null) {
    egresos.push(barra("Gastos operativos", resumen.egresos.gastos_operativos));
  } else {
    egresos.push(...resumen.egresos.gastos_por_categoria.map((fila) => barra(fila.nombre, fila.importe)));
  }
  return { ingresos, egresos };
}
