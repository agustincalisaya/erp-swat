import "server-only";

import { PDFDocument, PageSizes, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { CanalVenta, MedioPagoVenta, Prisma, TipoComprobanteVenta } from "@prisma/client";
import type { ComprobanteWebDescargable } from "./mis-pedidos.service";
import {
  COLORES,
  EMISOR,
  PUNTO_VENTA,
  dibujarIsotipo,
  numeroFiscalVisible,
  recortarTexto,
  textoCentrado,
  textoDerecha,
} from "./pdf-marca";

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const zona = { timeZone: "America/Argentina/Buenos_Aires" } as const;
const fechaHora = new Intl.DateTimeFormat("es-AR", {
  ...zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
const fechaCorta = new Intl.DateTimeFormat("es-AR", { ...zona, day: "2-digit", month: "2-digit", year: "numeric" });

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

/** HU-B10 — línea del pedido. `descripcion` = producto, `variante` = modelo · talle · color · género. */
export interface ItemComprobantePdf {
  descripcion: string;
  variante: string;
  sku: string;
  cantidad: number;
  precio_unitario: number | string;
  descuento_porcentual?: number | string | null;
}

/** HU-B10 — cobro de la venta (`VentaMedioPago`). */
export interface PagoComprobantePdf {
  medio: MedioPagoVenta;
  importe: number | string;
  referencia: string | null;
}

/**
 * HU-B10 — datos opcionales del PDF, comunes a los DTO de HU-E9 y HU-G3
 * (spec_modulo_B.md §2.10). Si falta alguno, el PDF se genera igual sin esa
 * sección.
 */
export interface DetalleComprobantePdf {
  canal?: CanalVenta;
  cliente?: { dni: string | null; nombre: string } | null;
  numero_venta?: string;
  items?: ItemComprobantePdf[];
  pagos?: PagoComprobantePdf[];
}

const SOLO_ACTIVOS = { is_active: true, deleted_at: null } as const;
const ORDEN_ALTA = [{ created_at: "asc" }, { id: "asc" }] as const;

/**
 * HU-B10 — proyección de solo lectura del `PedidoVenta` de un comprobante con
 * lo que necesita el PDF. La comparten los loaders de HU-E9 y HU-G3.
 */
export const SELECT_DETALLE_PDF = {
  numero_venta: true,
  canal: true,
  cliente: { select: { dni: true, nombre: true } },
  items: {
    where: SOLO_ACTIVOS,
    orderBy: [...ORDEN_ALTA],
    select: {
      cantidad: true,
      precio_unitario: true,
      descuento_porcentual: true,
      variante_sku: {
        select: { sku: true, modelo: true, talle: true, color: true, genero: true, producto_maestro: { select: { nombre: true } } },
      },
    },
  },
  medios_pago: { where: SOLO_ACTIVOS, orderBy: [...ORDEN_ALTA], select: { medio: true, importe: true, referencia: true } },
} satisfies Prisma.PedidoVentaSelect;

type PedidoDetallePdf = Prisma.PedidoVentaGetPayload<{ select: typeof SELECT_DETALLE_PDF }>;

/** Mapea el pedido proyectado con `SELECT_DETALLE_PDF` a los campos de HU-B10 del DTO. */
export function detallePdfDePedido(pedido: PedidoDetallePdf): Required<DetalleComprobantePdf> {
  return {
    numero_venta: pedido.numero_venta,
    canal: pedido.canal,
    cliente: pedido.cliente ? { dni: pedido.cliente.dni, nombre: pedido.cliente.nombre } : null,
    items: pedido.items.map((item) => {
      const v = item.variante_sku;
      return {
        descripcion: v.producto_maestro.nombre,
        variante: `${v.modelo} · Talle ${v.talle} · ${v.color} · ${v.genero}`,
        sku: v.sku,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario.toFixed(2),
        descuento_porcentual: item.descuento_porcentual?.toFixed(2) ?? null,
      };
    }),
    pagos: pedido.medios_pago.map((pago) => ({ medio: pago.medio, importe: pago.importe.toFixed(2), referencia: pago.referencia })),
  };
}

/**
 * HU-G3 — DTO del PDF de cualquier comprobante del repositorio interno. Es el
 * DTO de HU-E9 más el comprobante original. `monto` admite el string de dos
 * decimales del repositorio (sin pasar por `number`).
 */
export interface ComprobanteFiscalPdf extends Omit<ComprobanteWebDescargable, "monto"> {
  monto: number | string;
  comprobante_original?: {
    numero: string;
    tipo: TipoComprobanteVenta;
    numero_venta?: string;
    fecha_emision?: string;
  } | null;
}

const LEYENDA_SIMULADO = "SIMULADO — SIN VALIDEZ FISCAL ANTE ARCA";
const CANALES: Record<CanalVenta, string> = { MOSTRADOR: "Mostrador", WEB: "Web" };
const MEDIOS: Record<MedioPagoVenta, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  E_CHEQ: "E-cheq",
  MERCADO_PAGO: "Mercado Pago",
  TARJETA: "Tarjeta",
  CUENTA_CORRIENTE: "Cuenta corriente",
};
const ORIGINALES: Record<TipoComprobanteVenta, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  TICKET: "Ticket",
  NOTA_CREDITO: "Nota de Crédito",
};

/** Título, letra y código de tipo (Backlog Sprint 5, HU-B10). */
interface Identificacion {
  titulo: string;
  letra: string | null;
  codigo: string | null;
}

function identificar(comprobante: ComprobanteFiscalPdf): Identificacion {
  switch (comprobante.tipo) {
    case "FACTURA_A":
      return { titulo: "FACTURA", letra: "A", codigo: "001" };
    case "FACTURA_B":
      return { titulo: "FACTURA", letra: "B", codigo: "006" };
    case "TICKET":
      return { titulo: "TICKET", letra: "T", codigo: "083" };
    case "NOTA_CREDITO": {
      const original = comprobante.comprobante_original?.tipo;
      if (original === "FACTURA_A") return { titulo: "NOTA DE CRÉDITO", letra: "A", codigo: "003" };
      if (original === "FACTURA_B") return { titulo: "NOTA DE CRÉDITO", letra: "B", codigo: "008" };
      // NC sobre un Ticket o sin original: sin código definido (caso abierto, §2.10).
      return { titulo: "NOTA DE CRÉDITO", letra: null, codigo: null };
    }
  }
}

/** Importe en centavos enteros, para sumar sin errores de coma flotante. */
function centavos(valor: number | string): number {
  return Math.round(Number(valor) * 100);
}

/** `$ 1.234,50` / `-$ 1.234,50`, con guion ASCII y espacio común (WinAnsi). */
function formatoPesos(cents: number): string {
  return pesos.format(cents / 100).replace(/\u2212/g, "-").replace(/\u00a0/g, " ");
}

/** `13/10/2026, 11:24` → `13/10/2026 11:24` (hora de Argentina). */
function formatoFechaHora(iso: string): string {
  return fechaHora.format(new Date(iso)).replace(",", "");
}

function subtotalLinea(item: ItemComprobantePdf): number {
  const descuento = item.descuento_porcentual == null ? 0 : Number(item.descuento_porcentual);
  return Math.round(item.cantidad * centavos(item.precio_unitario) * (1 - descuento / 100));
}

// ──────────────────────────────────────────────────────────────────────────────
// Layout (A4, puntos)
// ──────────────────────────────────────────────────────────────────────────────

const [ANCHO_PAGINA, ALTO_PAGINA] = PageSizes.A4;
const MARGEN = 40;
const ANCHO_UTIL = ANCHO_PAGINA - 2 * MARGEN;
const ALTO_BANDA = 96;
const LADO_LETRA = 54;
const ALTO_FILA = 32;
const ALTO_ENCABEZADO_TABLA = 20;
/** Franja inferior con la paginación. */
const ALTO_FRANJA = 32;
/** El pie con el QR ocupa de `ALTO_FRANJA` a `Y_PIE + 12`. */
const Y_PIE = 150;
/** Límite inferior de una hoja sin pie (solo ítems). */
const Y_MINIMO = ALTO_FRANJA + 24;
/** Límite inferior de la hoja que lleva el pie. */
const Y_MINIMO_CON_PIE = Y_PIE + 24;
const COLUMNAS = { cantidad: MARGEN + 330, unitario: MARGEN + 420, subtotal: MARGEN + ANCHO_UTIL - 10 } as const;

interface Contexto {
  documento: PDFDocument;
  regular: PDFFont;
  negrita: PDFFont;
  identificacion: Identificacion;
  numeroVisible: string;
  fechaEmision: string;
}

/** Hoja nueva con banda, recuadro de letra y leyenda. Devuelve la `y` libre. */
function nuevaPagina(ctx: Contexto): { pagina: PDFPage; y: number } {
  const pagina = ctx.documento.addPage(PageSizes.A4);
  const { regular, negrita, identificacion } = ctx;
  const H = ALTO_PAGINA;
  const xDerecha = ANCHO_PAGINA - MARGEN;

  // 1. Banda de marca.
  pagina.drawRectangle({ x: 0, y: H - ALTO_BANDA, width: ANCHO_PAGINA, height: ALTO_BANDA, color: COLORES.banda });
  dibujarIsotipo(pagina, MARGEN, H - 28, 40);
  pagina.drawText("SWAT", { x: MARGEN + 52, y: H - 50, size: 22, font: negrita, color: COLORES.bandaTexto });
  pagina.drawText("INDUMENTARIAS", { x: MARGEN + 52, y: H - 64, size: 8.5, font: negrita, color: COLORES.oliva });
  pagina.drawText(`${EMISOR.bajada} · ${EMISOR.domicilio}`, { x: MARGEN + 52, y: H - 78, size: 8, font: regular, color: COLORES.bandaSuave });
  textoDerecha(pagina, identificacion.titulo, xDerecha, H - 44, { size: 15, font: negrita, color: COLORES.bandaTexto });
  textoDerecha(pagina, `N.° ${ctx.numeroVisible}`, xDerecha, H - 62, { size: 11, font: negrita, color: COLORES.oliva });
  textoDerecha(pagina, `Emitido el ${ctx.fechaEmision}`, xDerecha, H - 77, { size: 8.5, font: regular, color: COLORES.bandaSuave });

  // 2. Recuadro de letra y código, montado sobre el borde de la banda.
  const yLetra = H - ALTO_BANDA - LADO_LETRA / 2;
  if (identificacion.letra && identificacion.codigo) {
    const xCentro = ANCHO_PAGINA / 2;
    pagina.drawRectangle({
      x: xCentro - LADO_LETRA / 2, y: yLetra, width: LADO_LETRA, height: LADO_LETRA,
      color: COLORES.blanco, borderColor: COLORES.tinta, borderWidth: 1.4,
    });
    textoCentrado(pagina, identificacion.letra, xCentro, yLetra + 20, { size: 28, font: negrita, color: COLORES.tinta });
    textoCentrado(pagina, `COD. ${identificacion.codigo}`, xCentro, yLetra + 8, { size: 7, font: negrita, color: COLORES.suave });
  }

  // 3. Leyenda de simulado: 12 pt, no menor que en HU-G3 (B10-3).
  const y = yLetra - 14;
  pagina.drawRectangle({ x: MARGEN, y: y - 28, width: ANCHO_UTIL, height: 28, color: COLORES.avisoFondo });
  pagina.drawText(LEYENDA_SIMULADO, { x: MARGEN + 10, y: y - 19, size: 12, font: negrita, color: COLORES.avisoTexto });
  textoDerecha(pagina, "CAE y QR generados localmente por el sistema", MARGEN + ANCHO_UTIL - 10, y - 18, {
    size: 8, font: regular, color: COLORES.avisoTexto,
  });
  return { pagina, y: y - 28 - 16 };
}

function encabezadoTabla(ctx: Contexto, pagina: PDFPage, y: number): number {
  const estilo = { size: 7.5, font: ctx.negrita, color: COLORES.suave };
  pagina.drawRectangle({ x: MARGEN, y: y - ALTO_ENCABEZADO_TABLA, width: ANCHO_UTIL, height: ALTO_ENCABEZADO_TABLA, color: COLORES.secundario });
  pagina.drawText("DESCRIPCIÓN", { ...estilo, x: MARGEN + 10, y: y - 13 });
  textoDerecha(pagina, "CANT.", COLUMNAS.cantidad, y - 13, estilo);
  textoDerecha(pagina, "P. UNITARIO", COLUMNAS.unitario, y - 13, estilo);
  textoDerecha(pagina, "SUBTOTAL", COLUMNAS.subtotal, y - 13, estilo);
  return y - ALTO_ENCABEZADO_TABLA;
}

/** Genera una representación del comprobante ya emitido; no emite datos fiscales nuevos. */
export async function generarComprobanteWebPdf(comprobante: ComprobanteWebDescargable): Promise<Uint8Array> {
  return generarComprobanteFiscalPdf(comprobante);
}

/**
 * HU-B10 — PDF único de un comprobante archivado (HU-B7), para HU-E9 y HU-G3
 * (spec_modulo_B.md §2.10). No emite CAE, QR ni numeración nuevos: embebe el
 * QR persistido tal cual.
 */
export async function generarComprobanteFiscalPdf(comprobante: ComprobanteFiscalPdf): Promise<Uint8Array> {
  const qr = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(comprobante.qr_data_url);
  if (!qr) throw new QrFiscalInvalidoError();

  const documento = await PDFDocument.create();
  documento.setTitle(`Comprobante fiscal ${comprobante.numero}`);
  documento.setCreator(EMISOR.razon_social);
  const regular = await documento.embedFont(StandardFonts.Helvetica);
  const negrita = await documento.embedFont(StandardFonts.HelveticaBold);
  const imagen: PDFImage = await documento.embedPng(Buffer.from(qr[1]!, "base64")).catch(() => {
    throw new QrFiscalInvalidoError();
  });

  const esNC = comprobante.tipo === "NOTA_CREDITO";
  const signo = esNC ? -1 : 1;
  const original = comprobante.comprobante_original ?? null;
  const numeroVenta = comprobante.numero_venta ?? comprobante.numero;
  // La NC usa el número de su venta original (Backlog Sprint 5, HU-G4).
  const ventaOriginal = original ? (original.numero_venta ?? original.numero) : null;
  const ventaFiscal = (esNC ? ventaOriginal : null) ?? numeroVenta;
  const identificacion = identificar(comprobante);
  const ctx: Contexto = {
    documento,
    regular,
    negrita,
    identificacion,
    numeroVisible: numeroFiscalVisible(ventaFiscal) ?? ventaFiscal,
    fechaEmision: formatoFechaHora(comprobante.fecha_emision),
  };
  let { pagina, y } = nuevaPagina(ctx);

  // 4. Emisor | Comprobante | Cliente.
  const cliente = comprobante.cliente ?? null;
  const consumidorFinal = !cliente || (!cliente.dni && cliente.nombre === "Consumidor final");
  const columnas: [string, (readonly [string, string])[]][] = [
    ["EMISOR", [["Razón social", EMISOR.razon_social], ["CUIT (simulado)", EMISOR.cuit], ["Domicilio", EMISOR.domicilio], ["Punto de venta", PUNTO_VENTA]]],
    ["COMPROBANTE", [
      ["Pedido", numeroVenta],
      ["Canal", comprobante.canal ? CANALES[comprobante.canal] : "—"],
      ["Fecha de emisión", ctx.fechaEmision],
      ["CAE simulado", comprobante.cae_simulado],
    ]],
    ["CLIENTE", consumidorFinal
      ? [["Nombre", "Consumidor final"]]
      : [["Nombre", cliente.nombre], ["Documento", cliente.dni ? `DNI ${cliente.dni}` : "—"]]],
  ];
  const anchoColumna = (ANCHO_UTIL - 24) / 3;
  columnas.forEach(([titulo, filas], indice) => {
    const x = MARGEN + indice * (anchoColumna + 12);
    pagina.drawText(titulo, { x, y, size: 7.5, font: negrita, color: COLORES.primario });
    pagina.drawLine({ start: { x, y: y - 5 }, end: { x: x + anchoColumna, y: y - 5 }, thickness: 0.8, color: COLORES.borde });
    filas.forEach(([etiqueta, valor], fila) => {
      const yFila = y - 19 - fila * 24;
      pagina.drawText(etiqueta, { x, y: yFila, size: 7, font: regular, color: COLORES.suave });
      pagina.drawText(recortarTexto(valor, anchoColumna, { size: 9, font: negrita }), {
        x, y: yFila - 10, size: 9, font: negrita, color: COLORES.tinta,
      });
    });
  });
  y -= 19 + 4 * 24 + 8;

  // 5. Bloque «ANULA»: el original sale de la relación, nunca del número.
  if (esNC && original && ventaOriginal) {
    const partes = [
      `${ORIGINALES[original.tipo]} N.° ${numeroFiscalVisible(ventaOriginal) ?? ventaOriginal}`,
      `Pedido ${ventaOriginal}`,
      ...(original.fecha_emision ? [`emitida el ${fechaCorta.format(new Date(original.fecha_emision))}`] : []),
    ];
    pagina.drawRectangle({ x: MARGEN, y: y - 30, width: ANCHO_UTIL, height: 30, color: COLORES.secundario });
    pagina.drawRectangle({ x: MARGEN, y: y - 30, width: 3, height: 30, color: COLORES.primario });
    pagina.drawText("ANULA", { x: MARGEN + 12, y: y - 13, size: 7, font: negrita, color: COLORES.primario });
    pagina.drawText(partes.join("  ·  "), { x: MARGEN + 12, y: y - 24, size: 9, font: negrita, color: COLORES.tinta });
    y -= 44;
  }

  // 6. Ítems, con continuación en hojas nuevas que repiten el encabezado.
  const items = comprobante.items ?? [];
  if (items.length > 0) {
    y = encabezadoTabla(ctx, pagina, y);
    const anchoDescripcion = COLUMNAS.cantidad - 40 - (MARGEN + 10);
    // La línea de variante y SKU va debajo de la altura de los importes: puede llegar hasta el precio unitario.
    const anchoVariante = COLUMNAS.unitario - 60 - (MARGEN + 10);
    items.forEach((item, indice) => {
      if (y - ALTO_FILA < Y_MINIMO) {
        ({ pagina, y } = nuevaPagina(ctx));
        y = encabezadoTabla(ctx, pagina, y);
      }
      if (indice % 2 === 1) {
        pagina.drawRectangle({ x: MARGEN, y: y - ALTO_FILA, width: ANCHO_UTIL, height: ALTO_FILA, color: COLORES.fondo });
      }
      pagina.drawText(recortarTexto(item.descripcion, anchoDescripcion, { size: 9.5, font: negrita }), {
        x: MARGEN + 10, y: y - 13, size: 9.5, font: negrita, color: COLORES.tinta,
      });
      pagina.drawText(recortarTexto(`${item.variante}  ·  SKU ${item.sku}`, anchoVariante, { size: 7.5, font: regular }), {
        x: MARGEN + 10, y: y - 25, size: 7.5, font: regular, color: COLORES.suave,
      });
      const estilo = { size: 9.5, font: regular, color: COLORES.tinta };
      textoDerecha(pagina, String(item.cantidad), COLUMNAS.cantidad, y - 18, estilo);
      textoDerecha(pagina, formatoPesos(centavos(item.precio_unitario)), COLUMNAS.unitario, y - 18, estilo);
      textoDerecha(pagina, formatoPesos(signo * subtotalLinea(item)), COLUMNAS.subtotal, y - 18, { ...estilo, font: negrita });
      y -= ALTO_FILA;
    });
    pagina.drawLine({ start: { x: MARGEN, y }, end: { x: MARGEN + ANCHO_UTIL, y }, thickness: 0.8, color: COLORES.borde });
    y -= 18;
  }

  // 7 y 8. Medios de pago (izquierda) y totales (derecha), después del último ítem.
  const pagos = comprobante.pagos ?? [];
  const total = centavos(comprobante.monto);
  const subtotal = items.length > 0 ? items.reduce((suma, item) => suma + subtotalLinea(item), 0) : null;
  const descuento = subtotal !== null && subtotal > total ? subtotal - total : 0;
  // Misma regla que el Libro de IVA (HU-G4): neto = round(total / 1,21, 2).
  const iva = total - Math.round(total / 1.21);
  const filasTotales: [string, number][] = [
    ...(subtotal !== null ? [["Subtotal", signo * subtotal] as [string, number]] : []),
    ...(descuento > 0 ? [["Descuento", -descuento] as [string, number]] : []), // negativo también en la NC (spec B §2.10)
  ];
  const altoPagos = pagos.length > 0 ? 18 + pagos.length * 16 : 0;
  const altoTotales = filasTotales.length * 16 + 34;
  if (y - Math.max(altoPagos, altoTotales) < Y_MINIMO_CON_PIE) ({ pagina, y } = nuevaPagina(ctx));

  if (pagos.length > 0) {
    pagina.drawText(esNC ? "COBRADO EN LA VENTA ORIGINAL" : "MEDIOS DE PAGO", { x: MARGEN, y, size: 7.5, font: negrita, color: COLORES.primario });
    pagos.forEach((pago, indice) => {
      const yPago = y - 18 - indice * 16;
      const etiqueta = MEDIOS[pago.medio] + (pago.referencia ? `  ·  ref. ${pago.referencia}` : "");
      pagina.drawText(recortarTexto(etiqueta, 190, { size: 9, font: regular }), { x: MARGEN, y: yPago, size: 9, font: regular, color: COLORES.tinta });
      // Lo cobrado en la venta se informa en positivo, también en la NC.
      textoDerecha(pagina, formatoPesos(centavos(pago.importe)), MARGEN + 250, yPago, { size: 9, font: regular, color: COLORES.tinta });
    });
  }
  const xTotales = MARGEN + ANCHO_UTIL - 210;
  filasTotales.forEach(([etiqueta, valor], indice) => {
    const yTotal = y - 2 - indice * 16;
    pagina.drawText(etiqueta, { x: xTotales, y: yTotal, size: 9, font: regular, color: COLORES.suave });
    textoDerecha(pagina, formatoPesos(valor), MARGEN + ANCHO_UTIL, yTotal, { size: 9, font: regular, color: COLORES.tinta });
  });
  const yTotal = y - 2 - filasTotales.length * 16 - 8;
  pagina.drawRectangle({ x: xTotales - 10, y: yTotal - 22, width: 220, height: 30, color: COLORES.banda });
  pagina.drawText(esNC ? "TOTAL ACREDITADO" : "TOTAL", { x: xTotales, y: yTotal - 11, size: 8.5, font: negrita, color: COLORES.oliva });
  textoDerecha(pagina, formatoPesos(signo * total), MARGEN + ANCHO_UTIL - 8, yTotal - 12, { size: 14, font: negrita, color: COLORES.bandaTexto });

  // 9. Pie con el QR archivado, el CAE y la referencia interna.
  pagina.drawLine({ start: { x: MARGEN, y: Y_PIE + 12 }, end: { x: MARGEN + ANCHO_UTIL, y: Y_PIE + 12 }, thickness: 0.8, color: COLORES.borde });
  pagina.drawImage(imagen, { x: MARGEN, y: Y_PIE - 92, width: 96, height: 96 });
  const xPie = MARGEN + 112;
  pagina.drawText("QR FISCAL SIMULADO", { x: xPie, y: Y_PIE - 6, size: 7.5, font: negrita, color: COLORES.primario });
  const referencia = [identificacion.titulo, identificacion.letra].filter(Boolean).join(" ");
  ([
    ["CAE simulado", comprobante.cae_simulado],
    ["Comprobante", `${referencia} · ${ctx.numeroVisible}`],
    ["Referencia interna", comprobante.numero],
  ] as const).forEach(([etiqueta, valor], indice) => {
    pagina.drawText(etiqueta, { x: xPie, y: Y_PIE - 24 - indice * 22, size: 7, font: regular, color: COLORES.suave });
    pagina.drawText(valor, { x: xPie, y: Y_PIE - 34 - indice * 22, size: 9, font: negrita, color: COLORES.tinta });
  });

  // 10. Franja inferior y paginación en todas las hojas.
  const paginas = documento.getPages();
  paginas.forEach((hoja, indice) => {
    hoja.drawRectangle({ x: 0, y: 0, width: ANCHO_PAGINA, height: ALTO_FRANJA, color: COLORES.secundario });
    hoja.drawText("Documento generado por el ERP SWAT a partir del comprobante archivado. No válido como factura ante AFIP.", {
      x: MARGEN, y: 13, size: 7.5, font: regular, color: COLORES.suave,
    });
    textoDerecha(hoja, `Página ${indice + 1} de ${paginas.length}`, ANCHO_PAGINA - MARGEN, 13, { size: 7.5, font: regular, color: COLORES.suave });
  });
  return documento.save();
}
