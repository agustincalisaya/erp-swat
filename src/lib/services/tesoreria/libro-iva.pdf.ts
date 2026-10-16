import "server-only";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { COLORES, dibujarIsotipo } from "../ecommerce/pdf-marca";
import type { LibroIvaVista } from "./libro-iva.constants";
import { fechaLibro, monedaLibro, periodoLibro, tipoComprobanteLibro } from "./libro-iva.presentacion";

/** A4 horizontal, tabla paginada y sumas de la misma proyección que pantalla/TXT. */
export async function generarLibroIvaPdf(libro: LibroIvaVista): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ancho = 841.89, alto = 595.28, margen = 32, util = ancho - margen * 2;
  const columnas = [58, 112, 170, 108, 105, 105, util - 658];
  const titulo = `Libro de IVA - ${libro.tipo === "VENTAS" ? "Ventas" : "Compras"}`;
  const emitido = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  pdf.setTitle(`${titulo} - ${periodoLibro(libro.periodo)}`);
  pdf.setAuthor("SWAT Indumentarias");
  pdf.setSubject("Libro de IVA. Importes en ARS. Alícuota 21%.");
  const seguro = (valor: string) => Array.from(valor.replace(/[\r\n\t]/g, " ")).map((letra) => {
    try { normal.encodeText(letra); return letra; } catch { return "?"; }
  }).join("");
  function texto(pagina: PDFPage, valor: string, x: number, y: number, size = 9, bold = false, derecha = false, suave = false) {
    const font = bold ? negrita : normal;
    const limpio = seguro(valor);
    pagina.drawText(limpio, { x: derecha ? x - font.widthOfTextAtSize(limpio, size) : x, y, size, font, color: suave ? COLORES.suave : COLORES.tinta });
  }
  function envolver(valor: string, maximo: number, font: PDFFont, size: number): string[] {
    const lineas: string[] = [];
    let linea = "";
    for (const letra of seguro(valor)) {
      if (linea && font.widthOfTextAtSize(linea + letra, size) > maximo) {
        const espacio = linea.lastIndexOf(" ");
        if (espacio > linea.length / 2) {
          lineas.push(linea.slice(0, espacio)); linea = linea.slice(espacio + 1) + letra;
        } else { lineas.push(linea); linea = letra; }
      } else linea += letra;
    }
    lineas.push(linea);
    return lineas;
  }
  let pagina: PDFPage;
  let y = 0;
  function nuevaPagina(primera = false) {
    pagina = pdf.addPage([ancho, alto]);
    pagina.drawRectangle({ x: 0, y: alto - 7, width: ancho, height: 7, color: COLORES.primario });
    dibujarIsotipo(pagina, margen, alto - 27, 32);
    texto(pagina, "SWAT", margen + 43, alto - 42, 15, true);
    texto(pagina, "INDUMENTARIAS", margen + 43, alto - 55, 7, false, false, true);
    texto(pagina, titulo, ancho - margen, alto - 40, 19, true, true);
    texto(pagina, periodoLibro(libro.periodo), ancho - margen, alto - 59, 10, false, true, true);
    y = alto - 94;
    if (primera) {
      const metricas = [["NETO GRAVADO", libro.totales.neto], ["IVA DEL PERÍODO · 21%", libro.totales.iva], ["TOTAL DEL PERÍODO", libro.totales.total]];
      metricas.forEach(([nombre, valor], i) => {
        const x = margen + i * (util + 12) / 3;
        const anchoTarjeta = (util - 24) / 3;
        pagina.drawRectangle({ x, y: y - 59, width: anchoTarjeta, height: 66, color: i === 2 ? COLORES.secundario : COLORES.fondo });
        texto(pagina, nombre!, x + 14, y - 11, 8, false, false, true);
        texto(pagina, monedaLibro(valor!), x + 14, y - 38, 17, true);
      });
      y -= 85;
      texto(pagina, `${libro.totales.comprobantes} comprobantes  /  ${libro.totales.notas_credito} notas de crédito`, margen, y, 9, false, false, true);
      texto(pagina, "Importes en pesos argentinos (ARS)", ancho - margen, y, 8, false, true, true);
      y -= 22;
    }
    pagina.drawRectangle({ x: margen, y: y - 27, width: util, height: 27, color: COLORES.primario });
    const nombres = ["Fecha", "Comprobante", libro.tipo === "VENTAS" ? "Cliente" : "Proveedor", "Documento", "Neto", "IVA", "Total"];
    let x = margen;
    nombres.forEach((nombre, i) => {
      const derecha = i >= 4;
      const posicion = derecha ? x + columnas[i]! - 9 - negrita.widthOfTextAtSize(nombre, 8) : x + 9;
      pagina.drawText(nombre, { x: posicion, y: y - 17, font: negrita, size: 8, color: COLORES.blanco });
      x += columnas[i]!;
    });
    y -= 27;
  }
  nuevaPagina(true);
  if (!libro.filas.length) {
    texto(pagina!, "Sin comprobantes en este período", margen + 18, y - 38, 11, false, false, true);
    y -= 70;
  }
  libro.filas.forEach((fila, indice) => {
    const nombre = envolver(fila.denominacion, columnas[2]! - 18, normal, 8);
    const altura = Math.max(42, nombre.length * 11 + 18);
    if (y - altura < 100) nuevaPagina();
    if (indice % 2 === 0) pagina!.drawRectangle({ x: margen, y: y - altura, width: util, height: altura, color: COLORES.fondo });
    let x = margen + 9;
    texto(pagina!, fechaLibro(fila.fecha), x, y - 18, 8);
    x += columnas[0]!;
    texto(pagina!, tipoComprobanteLibro(fila.tipo), x, y - 16, 8, true);
    texto(pagina!, `${fila.pv}-${fila.numero}`, x, y - 29, 7, false, false, true);
    x += columnas[1]!;
    nombre.forEach((linea, i) => texto(pagina!, linea, x, y - 18 - i * 11, 8));
    x += columnas[2]!;
    texto(pagina!, fila.tipo_doc === "99" ? "Consumidor final" : fila.tipo_doc === "80" ? "CUIT" : "DNI", x, y - 16, 7, false, false, true);
    if (fila.tipo_doc !== "99") texto(pagina!, fila.numero_doc, x, y - 29, 8);
    x = margen + columnas.slice(0, 4).reduce((a, b) => a + b, 0);
    (["neto", "iva", "total"] as const).forEach((campo, i) => {
      x += columnas[i + 4]!;
      texto(pagina!, monedaLibro(fila[campo], false), x - 9, y - 23, 8, campo === "total", true);
    });
    y -= altura;
  });
  if (y < 110) nuevaPagina();
  pagina!.drawRectangle({ x: margen, y: y - 38, width: util, height: 34, color: COLORES.secundario });
  texto(pagina!, "TOTAL DEL PERÍODO", margen + 10, y - 25, 9, true);
  let x = margen + columnas.slice(0, 4).reduce((a, b) => a + b, 0);
  (["neto", "iva", "total"] as const).forEach((campo, i) => {
    x += columnas[i + 4]!;
    texto(pagina!, monedaLibro(libro.totales[campo], false), x - 9, y - 25, 9, true, true);
  });
  pdf.getPages().forEach((hoja, i, todas) => {
    hoja.drawLine({ start: { x: margen, y: 45 }, end: { x: ancho - margen, y: 45 }, thickness: 0.5, color: COLORES.borde });
    texto(hoja, `SWAT Indumentarias  /  ${libro.periodo}  /  ${libro.tipo === "VENTAS" ? "Ventas" : "Compras"}`, margen, 30, 7, false, false, true);
    texto(hoja, `Generado ${emitido}  -  Página ${i + 1} de ${todas.length}`, ancho - margen, 30, 7, false, true, true);
  });
  return pdf.save();
}
