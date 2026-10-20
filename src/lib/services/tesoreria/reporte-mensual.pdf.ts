import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COLORES, dibujarIsotipo } from "../ecommerce/pdf-marca";
import { formatearImporte } from "./reporte-mensual-extensiones.calculo";
import type { ReporteExportable } from "./reporte-mensual.export.types";

const ANCHO = 841.89, ALTO = 595.28, MARGEN = 32, UTIL = ANCHO - MARGEN * 2;
const MAX_PAGINAS = 300;

interface Tabla { titulo: string; columnas: string[]; filas: string[][]; pesos?: number[] }

function tablas(reporte: ReporteExportable): Tabla[] {
  const r = reporte.resumen;
  const resumen: string[][] = [
    ["Ingresos web", r.ingresos.web], ["Reintegros web", r.ingresos.reintegros_web],
    ["Mostrador", r.ingresos.mostrador], ["Total ingresos", r.ingresos.total],
    ["Proveedores", r.egresos.proveedores], ["Gastos operativos", r.egresos.gastos_operativos],
    ["Total egresos", r.egresos.total], ["Resultado neto", r.resultado_neto],
    ["Egresos sobre ingresos", r.porcentaje_egresos_sobre_ingresos === null ? "—" : `${r.porcentaje_egresos_sobre_ingresos.toFixed(1).replace(".", ",")} %`],
    ["Cuenta corriente informativa", r.ventas_cuenta_corriente_informativo],
  ].map(([nombre, valor], i) => [nombre, i === 8 ? valor : formatearImporte(valor)]);
  const resultado: Tabla[] = [
    { titulo: "Resumen", columnas: ["Concepto", "Importe ($)"], filas: resumen, pesos: [3, 1] },
    { titulo: "Mostrador por medio", columnas: ["Medio", "Importe ($)"],
      filas: r.ingresos.mostrador_por_medio.map((f) => [f.medio.replaceAll("_", " "), formatearImporte(f.importe)]), pesos: [3, 1] },
  ];
  if (r.egresos.gastos_por_categoria !== null) resultado.push({
    titulo: "Gastos por categoría", columnas: ["Categoría", "Estado", "Importe ($)"],
    filas: r.egresos.gastos_por_categoria.map((f) => [f.nombre, f.activa ? "Activa" : "Inactiva", formatearImporte(f.importe)]),
    pesos: [3, 1, 1],
  });
  resultado.push({ titulo: "Detalle de movimientos", columnas: ["Fecha", "Origen", "Concepto", "Estado", "Importe ($)"],
    filas: reporte.detalle.map((f) => [f.fecha.slice(0, 10), f.tipo.replaceAll("_", " "), f.concepto,
      f.impacta_resultado ? "En caja" : "Informativo", formatearImporte(f.importe)]), pesos: [1, 1.4, 3, 1, 1] });
  for (const bloque of reporte.bloques) resultado.push({ titulo: bloque.titulo, columnas: bloque.columnas, filas: bloque.filas });
  return resultado;
}

/** PDF de la misma proyección G14/G15; jamás calcula totales desde filas. */
export async function generarReporteMensualPdf(reporte: ReporteExportable): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Noto Sans, OFL-1.1. Asset local y licencia en public/fonts.
  const extraBytes = readFileSync(join(process.cwd(), "public", "fonts", "noto-sans-latin-ext-400-normal.woff"));
  const extra = await pdf.embedFont(extraBytes);
  const soporteExtra = fontkit.create(extraBytes) as { hasGlyphForCodePoint: (codigo: number) => boolean };
  const periodo = `${reporte.resumen.periodo.anio}-${String(reporte.resumen.periodo.mes).padStart(2, "0")}`;
  pdf.setTitle(`Reporte mensual - ${periodo}`);
  pdf.setAuthor("SWAT Indumentarias");
  pdf.setSubject("Reporte mensual de ingresos y egresos. Importes en ARS.");

  const normalizar = (s: string) => s.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ");
  const fuenteDe = (letra: string, preferida: PDFFont) => {
    try { preferida.encodeText(letra); return preferida; } catch {
      if (soporteExtra.hasGlyphForCodePoint(letra.codePointAt(0)!)) return extra;
      throw new Error("PDF_CARACTER_NO_SOPORTADO");
    }
  };
  function escribir(pagina: PDFPage, s: string, x: number, y: number, size = 9, bold = false) {
    const preferida = bold ? negrita : normal;
    const limpio = normalizar(s);
    let cursor = x;
    let tramo = "", fuenteTramo: PDFFont | null = null;
    const vaciar = () => {
      if (tramo && fuenteTramo) {
        pagina.drawText(tramo, { x: cursor, y, size, font: fuenteTramo, color: COLORES.tinta });
        cursor += fuenteTramo.widthOfTextAtSize(tramo, size);
      }
      tramo = "";
    };
    for (const letra of limpio) {
      const fuente = fuenteDe(letra, preferida);
      if (fuente !== fuenteTramo) { vaciar(); fuenteTramo = fuente; }
      tramo += letra;
    }
    vaciar();
  }
  function envolver(s: string, anchoMaximo: number, size: number, fuente = normal): string[] {
    const lineas: string[] = [];
    let linea = "";
    let anchoLinea = 0;
    for (const letra of normalizar(s)) {
      const anchoLetra = fuenteDe(letra, fuente).widthOfTextAtSize(letra, size);
      if (linea && anchoLinea + anchoLetra > anchoMaximo) {
        lineas.push(linea); linea = letra; anchoLinea = anchoLetra;
      } else { linea += letra; anchoLinea += anchoLetra; }
    }
    lineas.push(linea);
    return lineas;
  }

  let pagina: PDFPage;
  let y = 0;
  function nuevaPagina() {
    if (pdf.getPageCount() >= MAX_PAGINAS) throw new Error("PDF_DEMASIADAS_PAGINAS");
    pagina = pdf.addPage([ANCHO, ALTO]);
    pagina.drawRectangle({ x: 0, y: ALTO - 7, width: ANCHO, height: 7, color: COLORES.primario });
    dibujarIsotipo(pagina, MARGEN, ALTO - 27, 32);
    escribir(pagina, "SWAT INDUMENTARIAS", MARGEN + 43, ALTO - 43, 12, true);
    escribir(pagina, `Reporte mensual  ·  ${periodo}`, ANCHO - 258, ALTO - 43, 13, true);
    y = ALTO - 84;
  }
  nuevaPagina();
  for (const tabla of tablas(reporte)) {
    if (y < 125) nuevaPagina();
    escribir(pagina!, tabla.titulo, MARGEN, y, 12, true); y -= 18;
    const pesos = tabla.pesos ?? tabla.columnas.map((_, i) => i === 0 ? 2 : 1);
    const sumaPesos = pesos.reduce((a, b) => a + b, 0);
    const anchos = pesos.map((peso) => UTIL * peso / sumaPesos);
    const encabezado = () => {
      pagina!.drawRectangle({ x: MARGEN, y: y - 25, width: UTIL, height: 25, color: COLORES.secundario });
      let x = MARGEN + 7;
      tabla.columnas.forEach((nombre, i) => { escribir(pagina!, nombre, x, y - 16, 8, true); x += anchos[i]; });
      y -= 25;
    };
    encabezado();
    for (const fila of tabla.filas) {
      const lineas = fila.map((valor, i) => envolver(valor, anchos[i] - 14, 8));
      const altura = Math.max(22, ...lineas.map((l) => l.length * 11 + 9));
      if (altura > ALTO - 145) throw new Error("PDF_FILA_DEMASIADO_LARGA");
      if (y - altura < 65) { nuevaPagina(); escribir(pagina!, tabla.titulo, MARGEN, y, 12, true); y -= 18; encabezado(); }
      let x = MARGEN + 7;
      lineas.forEach((partes, i) => { partes.forEach((parte, j) => escribir(pagina!, parte, x, y - 13 - j * 11, 8)); x += anchos[i]; });
      y -= altura;
      pagina!.drawLine({ start: { x: MARGEN, y }, end: { x: ANCHO - MARGEN, y }, thickness: 0.4, color: COLORES.borde });
    }
    if (tabla.filas.length === 0) { escribir(pagina!, "Sin filas para este mes", MARGEN + 8, y - 15, 8); y -= 28; }
    y -= 20;
  }
  if (y < 95) nuevaPagina();
  escribir(pagina!, "La fecha de facturación aproxima el cobro de mostrador. Gastos sin IVA discriminado.", MARGEN, y - 8, 8);
  const todas = pdf.getPages();
  todas.forEach((hoja, i) => {
    hoja.drawLine({ start: { x: MARGEN, y: 47 }, end: { x: ANCHO - MARGEN, y: 47 }, thickness: 0.5, color: COLORES.borde });
    escribir(hoja, `SWAT Indumentarias · ${periodo}`, MARGEN, 31, 8);
    escribir(hoja, `Página ${i + 1} de ${todas.length}`, ANCHO - 110, 31, 8);
  });
  return pdf.save();
}
