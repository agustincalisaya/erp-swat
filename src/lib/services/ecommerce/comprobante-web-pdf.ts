import "server-only";

import { PDFDocument, PageSizes, StandardFonts, rgb } from "pdf-lib";
import type { ComprobanteWebDescargable } from "./mis-pedidos.service";

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const fecha = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Genera una representación del comprobante ya emitido; no emite datos fiscales nuevos. */
export async function generarComprobanteWebPdf(comprobante: ComprobanteWebDescargable): Promise<Uint8Array> {
  const qr = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(comprobante.qr_data_url);
  if (!qr) throw new Error("El QR fiscal persistido no es una imagen PNG válida");

  const documento = await PDFDocument.create();
  documento.setTitle(`Comprobante fiscal ${comprobante.numero}`);
  documento.setCreator("SWAT Indumentarias");
  const pagina = documento.addPage(PageSizes.A4);
  const regular = await documento.embedFont(StandardFonts.Helvetica);
  const negrita = await documento.embedFont(StandardFonts.HelveticaBold);
  const imagen = await documento.embedPng(Buffer.from(qr[1], "base64"));
  const { height } = pagina.getSize();
  const tinta = rgb(0.08, 0.15, 0.29);

  pagina.drawText("SWAT Indumentarias", { x: 48, y: height - 62, size: 19, font: negrita, color: tinta });
  pagina.drawText("Comprobante fiscal", { x: 48, y: height - 95, size: 16, font: negrita, color: tinta });
  pagina.drawText("Comprobante simulado — sin integración ni validación real con AFIP", {
    x: 48, y: height - 124, size: 10, font: negrita, color: rgb(0.62, 0.18, 0.12),
  });

  const filas = [
    ["Tipo de comprobante", comprobante.tipo.replaceAll("_", " ")],
    ["Número de pedido/comprobante", comprobante.numero],
    ["Fecha de emisión", fecha.format(new Date(comprobante.fecha_emision))],
    ["Monto total", pesos.format(comprobante.monto).replace(/\u00a0/g, " ")],
    ["CAE simulado", comprobante.cae_simulado],
  ] as const;
  filas.forEach(([etiqueta, valor], indice) => {
    const y = height - 174 - indice * 38;
    pagina.drawText(etiqueta, { x: 48, y, size: 9, font: regular, color: rgb(0.38, 0.43, 0.51) });
    pagina.drawText(valor, { x: 48, y: y - 16, size: 12, font: negrita, color: tinta });
  });

  pagina.drawText("QR fiscal simulado", { x: 48, y: height - 390, size: 11, font: negrita, color: tinta });
  pagina.drawImage(imagen, { x: 48, y: height - 575, width: 170, height: 170 });
  pagina.drawText("Documento generado a partir del comprobante archivado. Sin validación ante AFIP.", {
    x: 48, y: 55, size: 9, font: regular, color: rgb(0.38, 0.43, 0.51),
  });
  return documento.save();
}
