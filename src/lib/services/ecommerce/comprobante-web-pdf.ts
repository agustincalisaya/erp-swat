import "server-only";

import { PDFDocument, PageSizes, StandardFonts, rgb } from "pdf-lib";
import type { CanalVenta, TipoComprobanteVenta } from "@prisma/client";
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

/**
 * El `qr_data_url` persistido no es un PNG embebible: dato histórico
 * inválido. Nunca se genera un PDF "completo" sin QR (HU-G3, G3-3); el
 * repositorio interno lo responde como `422 COMPROBANTE_QR_INVALIDO`.
 */
export class QrFiscalInvalidoError extends Error {
  constructor() {
    super("El QR fiscal persistido no es una imagen PNG válida");
    this.name = "QrFiscalInvalidoError";
  }
}

/**
 * HU-G3 — DTO del PDF de cualquier comprobante del repositorio interno. Es el
 * DTO de HU-E9 más canal, cliente y comprobante original. `monto` admite el
 * string de dos decimales del repositorio (sin pasar por `number`).
 *
 * Con `canal` presente se dibujan además la leyenda
 * `SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP` y las filas de canal, cliente y
 * original. Sin `canal` (DTO de HU-E9) la salida es la misma de siempre.
 */
export interface ComprobanteFiscalPdf extends Omit<ComprobanteWebDescargable, "monto"> {
  monto: number | string;
  canal?: CanalVenta;
  cliente?: { dni: string | null; nombre: string } | null;
  comprobante_original?: { numero: string; tipo: TipoComprobanteVenta } | null;
}

const LEYENDA_SIMULADO = "SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP";
const CANALES: Record<CanalVenta, string> = { MOSTRADOR: "Mostrador", WEB: "Web" };

/** Genera una representación del comprobante ya emitido; no emite datos fiscales nuevos. */
export async function generarComprobanteWebPdf(comprobante: ComprobanteWebDescargable): Promise<Uint8Array> {
  return generarComprobanteFiscalPdf(comprobante);
}

/** HU-G3 — PDF de un comprobante archivado (HU-B7). No emite CAE ni QR nuevos. */
export async function generarComprobanteFiscalPdf(comprobante: ComprobanteFiscalPdf): Promise<Uint8Array> {
  const qr = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(comprobante.qr_data_url);
  if (!qr) throw new QrFiscalInvalidoError();

  const documento = await PDFDocument.create();
  documento.setTitle(`Comprobante fiscal ${comprobante.numero}`);
  documento.setCreator("SWAT Indumentarias");
  const pagina = documento.addPage(PageSizes.A4);
  const regular = await documento.embedFont(StandardFonts.Helvetica);
  const negrita = await documento.embedFont(StandardFonts.HelveticaBold);
  const imagen = await documento.embedPng(Buffer.from(qr[1], "base64")).catch(() => {
    throw new QrFiscalInvalidoError();
  });
  const { height } = pagina.getSize();
  const tinta = rgb(0.08, 0.15, 0.29);

  pagina.drawText("SWAT Indumentarias", { x: 48, y: height - 62, size: 19, font: negrita, color: tinta });
  pagina.drawText("Comprobante fiscal", { x: 48, y: height - 95, size: 16, font: negrita, color: tinta });
  pagina.drawText("Comprobante simulado — sin integración ni validación real con AFIP", {
    x: 48, y: height - 124, size: 10, font: negrita, color: rgb(0.62, 0.18, 0.12),
  });
  if (comprobante.canal) {
    pagina.drawText(LEYENDA_SIMULADO, { x: 48, y: height - 146, size: 12, font: negrita, color: rgb(0.62, 0.18, 0.12) });
  }

  const cliente = comprobante.cliente ?? null;
  const filas: (readonly [string, string])[] = [
    ["Tipo de comprobante", comprobante.tipo.replaceAll("_", " ")],
    ["Número de pedido/comprobante", comprobante.numero],
    ["Fecha de emisión", fecha.format(new Date(comprobante.fecha_emision))],
    ["Monto total", pesos.format(comprobante.monto as number | Intl.StringNumericLiteral).replace(/\u00a0/g, " ")],
    ["CAE simulado", comprobante.cae_simulado],
    ...(comprobante.canal
      ? [
          ["Canal de venta", CANALES[comprobante.canal]] as const,
          ["Cliente", cliente?.dni ? `${cliente.nombre} · DNI ${cliente.dni}` : (cliente?.nombre ?? "Consumidor final")] as const,
        ]
      : []),
    ...(comprobante.comprobante_original
      ? [[
          "Comprobante original",
          `${comprobante.comprobante_original.numero} (${comprobante.comprobante_original.tipo.replaceAll("_", " ")})`,
        ] as const]
      : []),
  ];
  filas.forEach(([etiqueta, valor], indice) => {
    const y = height - 174 - indice * 38;
    pagina.drawText(etiqueta, { x: 48, y, size: 9, font: regular, color: rgb(0.38, 0.43, 0.51) });
    pagina.drawText(valor, { x: 48, y: y - 16, size: 12, font: negrita, color: tinta });
  });

  // Con las 5 filas de HU-E9 queda en `height - 390`, igual que antes.
  const yQr = height - 200 - filas.length * 38;
  pagina.drawText("QR fiscal simulado", { x: 48, y: yQr, size: 11, font: negrita, color: tinta });
  pagina.drawImage(imagen, { x: 48, y: yQr - 185, width: 170, height: 170 });
  pagina.drawText("Documento generado a partir del comprobante archivado. Sin validación ante AFIP.", {
    x: 48, y: 55, size: 9, font: regular, color: rgb(0.38, 0.43, 0.51),
  });
  return documento.save();
}
