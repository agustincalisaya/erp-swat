import type { ReporteExportable } from "./reporte-mensual.export.types";

export type TipoCeldaCsv = "texto_usuario" | "texto_sistema" | "importe_sistema" | "porcentaje_sistema";
export interface CeldaCsv { valor: string; tipo: TipoCeldaCsv }
const celda = (valor: string, tipo: TipoCeldaCsv = "texto_sistema"): CeldaCsv => ({ valor, tipo });
const textoUsuario = (valor: string) => celda(valor, "texto_usuario");
const IMPORTE = /^[+-]?\d{1,3}(\.\d{3})*,\d{2}$/;
const PORCENTAJE = /^[+-]?\d{1,3}(\.\d{3})*,\d %$/;

/** Solo cambia la presentación de un Importe G14; no hace aritmética. */
function importe(valor: string): CeldaCsv {
  if (!/^-?\d+\.\d{2}$/.test(valor)) throw new RangeError("Importe de reporte inválido");
  const signo = valor.startsWith("-") ? "-" : "";
  const [entero, decimales] = (signo ? valor.slice(1) : valor).split(".");
  return celda(`${signo}${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimales}`, "importe_sistema");
}

function porcentaje(valor: number | null): CeldaCsv {
  if (valor === null) return celda("—");
  if (!Number.isFinite(valor)) throw new RangeError("Porcentaje de reporte inválido");
  const signo = valor < 0 ? "-" : "";
  const [entero, decimal] = Math.abs(valor).toFixed(1).split(".");
  return celda(`${signo}${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal} %`, "porcentaje_sistema");
}

function tipoBloque(clave: string, columna: number, valor: string): CeldaCsv {
  if (clave === "egresos_por_proveedor") {
    if (columna === 0) return textoUsuario(valor);
    if (columna === 1 && IMPORTE.test(valor)) return celda(valor, "importe_sistema");
    if (columna === 2 && /^\d+$/.test(valor)) return celda(valor);
  }
  if (clave === "comparacion_mes_anterior") {
    if (columna >= 1 && columna <= 3 && IMPORTE.test(valor)) return celda(valor, "importe_sistema");
    if (columna === 4 && PORCENTAJE.test(valor)) return celda(valor, "porcentaje_sistema");
  }
  return textoUsuario(valor);
}

function escapar({ valor, tipo }: CeldaCsv): string {
  if ((tipo === "importe_sistema" && !IMPORTE.test(valor)) ||
      (tipo === "porcentaje_sistema" && !PORCENTAJE.test(valor))) throw new RangeError("Celda numérica inválida");
  let seguro = valor;
  // Algunas hojas omiten espacios o controles iniciales antes de evaluar fórmulas.
  if ((tipo === "texto_usuario" || tipo === "texto_sistema") && /^[\s\x00-\x1f]*[=+\-@]/u.test(seguro)) seguro = `'${seguro}`;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

/** UTF-8 con BOM, punto y coma y CRLF. Recibe únicamente la proyección autorizada. */
export function serializarReporteCsv(reporte: ReporteExportable): Uint8Array {
  const { resumen: r, detalle, bloques } = reporte;
  const filas: CeldaCsv[][] = [];
  const agregar = (...celdas: CeldaCsv[]) => filas.push(celdas);
  const titulo = (texto: string) => { agregar(); agregar(celda(texto)); };
  agregar(celda("Reporte mensual"), celda(`${r.periodo.anio}-${String(r.periodo.mes).padStart(2, "0")}`));
  titulo("Resumen");
  const total = (nombre: string, valor: string) => agregar(celda(nombre), importe(valor));
  total("Ingresos web", r.ingresos.web);
  total("Reintegros web", r.ingresos.reintegros_web);
  total("Mostrador", r.ingresos.mostrador);
  total("Total ingresos", r.ingresos.total);
  total("Proveedores", r.egresos.proveedores);
  total("Gastos operativos", r.egresos.gastos_operativos);
  total("Total egresos", r.egresos.total);
  total("Resultado neto", r.resultado_neto);
  agregar(celda("Egresos sobre ingresos"), porcentaje(r.porcentaje_egresos_sobre_ingresos));
  total("Cuenta corriente informativa", r.ventas_cuenta_corriente_informativo);
  titulo("Mostrador por medio");
  agregar(celda("Medio"), celda("Importe"));
  for (const f of r.ingresos.mostrador_por_medio) agregar(celda(f.medio), importe(f.importe));
  if (r.egresos.gastos_por_categoria !== null) {
    titulo("Gastos por categoría");
    agregar(celda("Categoría"), celda("Estado"), celda("Importe"));
    for (const f of r.egresos.gastos_por_categoria) agregar(textoUsuario(f.nombre), celda(f.activa ? "Activa" : "Inactiva"), importe(f.importe));
  }
  titulo("Detalle de movimientos");
  agregar(...["Fecha", "Origen", "Concepto", "Estado", "Importe"].map((s) => celda(s)));
  for (const f of detalle) agregar(celda(f.fecha), celda(f.tipo), textoUsuario(f.concepto), celda(f.impacta_resultado ? "En caja" : "Informativo"), importe(f.importe));
  for (const bloque of bloques) {
    titulo(bloque.titulo);
    agregar(...bloque.columnas.map((s) => celda(s)));
    for (const fila of bloque.filas) agregar(...fila.map((s, i) => tipoBloque(bloque.clave, i, s)));
  }
  return new TextEncoder().encode(`\uFEFF${filas.map((fila) => fila.map(escapar).join(";")).join("\r\n")}\r\n`);
}
