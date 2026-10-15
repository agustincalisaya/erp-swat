/**
 * HU-B10 — renderer único del comprobante fiscal (spec_modulo_B.md §2.10).
 *
 * Cada caso genera el PDF, lo vuelve a cargar con `PDFDocument.load` y
 * verifica el texto extraído (B10-8: los textos siguen siendo extraíbles).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import QRCode from "qrcode";
import { cargarComprobantePdf, extraerPdf } from "./comprobante-pdf.test-helpers.ts";

type Tipo = "FACTURA_A" | "FACTURA_B" | "TICKET" | "NOTA_CREDITO";
interface Dto {
  numero: string;
  tipo: Tipo;
  fecha_emision: string;
  monto: number | string;
  cae_simulado: string;
  qr_data_url: string;
  es_simulado: boolean;
  canal?: "MOSTRADOR" | "WEB";
  cliente?: { dni: string | null; nombre: string } | null;
  numero_venta?: string;
  comprobante_original?: { numero: string; tipo: Tipo; numero_venta?: string; fecha_emision?: string } | null;
  items?: { descripcion: string; variante: string; sku: string; cantidad: number; precio_unitario: number | string; descuento_porcentual?: number | string | null }[];
  pagos?: { medio: string; importe: number | string; referencia: string | null }[];
}

const { generarComprobanteFiscalPdf, generarComprobanteWebPdf } = cargarComprobantePdf<{
  generarComprobanteFiscalPdf: (dto: Dto) => Promise<Uint8Array>;
  generarComprobanteWebPdf: (dto: Dto) => Promise<Uint8Array>;
}>();

/** QR con el mismo payload que arma HU-B7 (`comprobante-fiscal.service.ts`). */
async function qrB7(tipo: Tipo, numero: string, importe: number, cae: string): Promise<string> {
  const payload = { ver: 1, simulado: true, cuitEmisor: "30000000007", tipoComprobante: tipo, numeroComprobante: numero, importe, moneda: "PES", cae };
  return QRCode.toDataURL(JSON.stringify(payload), { errorCorrectionLevel: "M" });
}

const camisaCorta = { descripcion: "Camisa Táctica", variante: "Manga Corta · Talle L · Negro · HOMBRE", sku: "CAMTAC-MANGA CORTA-L-NEGRO-H" };
const camisaLarga = { descripcion: "Camisa Táctica", variante: "Manga Larga · Talle S · Verde · MUJER", sku: "CAMTAC-MANGA LARGA-S-VERDE-M" };

async function facturaWeb(): Promise<Dto> {
  return {
    numero: "V-2026-000007",
    numero_venta: "V-2026-000007",
    tipo: "FACTURA_B",
    fecha_emision: "2026-10-13T14:24:00.000Z",
    monto: "44300.00",
    cae_simulado: "68031598270007",
    qr_data_url: await qrB7("FACTURA_B", "V-2026-000007", 44300, "68031598270007"),
    es_simulado: true,
    canal: "WEB",
    cliente: { dni: "30123456", nombre: "Juan Pérez" },
    items: [
      { ...camisaCorta, cantidad: 1, precio_unitario: "22800.00", descuento_porcentual: null },
      { ...camisaLarga, cantidad: 1, precio_unitario: "21500.00", descuento_porcentual: null },
    ],
    pagos: [{ medio: "MERCADO_PAGO", importe: "44300.00", referencia: "1320000000007" }],
  };
}

function incluye(texto: string, datos: string[]): void {
  for (const dato of datos) assert.ok(texto.includes(dato), `falta «${dato}» en:\n${texto}`);
}

/** Tamaño de fuente (operador `Tf`) vigente al dibujar `texto`. */
function tamanoDe(operadores: string, texto: string): number {
  const hex = Buffer.from(texto.replace(/—/g, "\x97"), "latin1").toString("hex").toUpperCase();
  const indice = operadores.indexOf(`<${hex}> Tj`);
  assert.ok(indice >= 0, `no se dibujó «${texto}»`);
  const tamanos = [...operadores.slice(0, indice).matchAll(/ ([\d.]+) Tf/g)];
  return Number(tamanos.at(-1)![1]);
}

function anchoImagenes(documento: Awaited<ReturnType<typeof extraerPdf>>["documento"]): number[] {
  return documento.context
    .enumerateIndirectObjects()
    .map(([, objeto]) => objeto)
    .filter((objeto): objeto is PDFRawStream => objeto instanceof PDFRawStream && objeto.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
    .map((imagen) => (imagen.dict.get(PDFName.of("Width")) as PDFNumber).asNumber());
}

test("B10-2/4/5 · Factura B web con ítems y pagos: marca, número, tres columnas, ítems, pagos y totales", async () => {
  const dto = await facturaWeb();
  const { texto, operadores, documento } = await extraerPdf(await generarComprobanteFiscalPdf(dto));
  assert.equal(documento.getPageCount(), 1);
  incluye(texto, [
    // Banda y recuadro de letra y código.
    "SWAT", "INDUMENTARIAS", "FACTURA", "N.° 00001-26000007", "Emitido el 13/10/2026 11:24", "B", "COD. 006",
    // Emisor | Comprobante | Cliente.
    "EMISOR", "SWAT Indumentarias", "30-00000000-7", "Sucursal Salta", "00001",
    "COMPROBANTE", "V-2026-000007", "Web", "68031598270007",
    "CLIENTE", "Juan Pérez", "DNI 30123456",
    // Ítems.
    "DESCRIPCIÓN", "CANT.", "P. UNITARIO", "SUBTOTAL",
    "Camisa Táctica", "Manga Corta · Talle L · Negro · HOMBRE  ·  SKU CAMTAC-MANGA CORTA-L-NEGRO-H",
    "Manga Larga · Talle S · Verde · MUJER  ·  SKU CAMTAC-MANGA LARGA-S-VERDE-M", "$ 22.800,00", "$ 21.500,00",
    // Pagos y totales: neto = round(44300 / 1,21) = 36611,57 → IVA 7688,43.
    "MEDIOS DE PAGO", "Mercado Pago  ·  ref. 1320000000007",
    "Subtotal", "IVA contenido (21 %)", "$ 7.688,43", "TOTAL", "$ 44.300,00",
    // Pie.
    "QR FISCAL SIMULADO", "FACTURA B · 00001-26000007", "Referencia interna", "Página 1 de 1",
  ]);
  assert.ok(!texto.includes("Descuento"), "sin cupón no hay línea de descuento");
  assert.ok(!texto.includes("ANULA"));
  assert.match(operadores[0]!, /\/Image-/);
});

test("B10-3 · la leyenda de simulado se muestra destacada y no menor que en HU-G3 (12 pt)", async () => {
  const { texto, operadores } = await extraerPdf(await generarComprobanteFiscalPdf(await facturaWeb()));
  incluye(texto, ["SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP"]);
  assert.ok(tamanoDe(operadores[0]!, "SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP") >= 12);
});

test("B10-5 · con cupón el TOTAL es monto_total (el importe del QR) y aparece la línea «Descuento»", async () => {
  const dto: Dto = {
    ...(await facturaWeb()),
    numero: "V-2026-000010",
    numero_venta: "V-2026-000010",
    monto: "19380.00",
    qr_data_url: await qrB7("FACTURA_B", "V-2026-000010", 19380, "68031598270010"),
    items: [{ ...camisaCorta, cantidad: 1, precio_unitario: "22800.00" }],
    pagos: [{ medio: "MERCADO_PAGO", importe: "19380.00", referencia: "1320000000010" }],
  };
  const { texto } = await extraerPdf(await generarComprobanteFiscalPdf(dto));
  // neto = round(19380 / 1,21) = 16016,53 → IVA 3363,47.
  incluye(texto, ["Subtotal", "$ 22.800,00", "Descuento", "-$ 3.420,00", "IVA contenido (21 %)", "$ 3.363,47", "TOTAL", "$ 19.380,00"]);
});

test("B10-5 · el descuento porcentual de la línea se aplica al subtotal del ítem", async () => {
  const dto: Dto = {
    ...(await facturaWeb()),
    monto: "40000.00",
    items: [{ ...camisaCorta, cantidad: 2, precio_unitario: "25000.00", descuento_porcentual: "20.00" }],
    pagos: [{ medio: "EFECTIVO", importe: "40000.00", referencia: null }],
  };
  const { texto } = await extraerPdf(await generarComprobanteFiscalPdf(dto));
  incluye(texto, ["$ 25.000,00", "$ 40.000,00", "Efectivo"]);
  assert.ok(!texto.includes("Descuento"), "el subtotal ya coincide con el total");
});

test("B10-6 · NC B: bloque ANULA con el original, TOTAL ACREDITADO negativo y monto positivo en el DTO", async () => {
  const dto: Dto = {
    numero: "NC-V-2026-000001",
    numero_venta: "V-2026-000001",
    tipo: "NOTA_CREDITO",
    fecha_emision: "2026-10-15T18:57:00.000Z",
    monto: "45000.00",
    cae_simulado: "68031598279001",
    qr_data_url: await qrB7("NOTA_CREDITO", "NC-V-2026-000001", 45000, "68031598279001"),
    es_simulado: true,
    canal: "MOSTRADOR",
    cliente: { dni: "30123456", nombre: "Juan Pérez" },
    comprobante_original: { numero: "V-2026-000001", tipo: "FACTURA_B", numero_venta: "V-2026-000001", fecha_emision: "2026-10-13T12:00:00.000Z" },
    items: [{ ...camisaCorta, cantidad: 1, precio_unitario: "45000.00" }],
    pagos: [
      { medio: "EFECTIVO", importe: "20000.00", referencia: null },
      { medio: "TRANSFERENCIA", importe: "25000.00", referencia: "OP-887654" },
    ],
  };
  const { texto } = await extraerPdf(await generarComprobanteFiscalPdf(dto));
  incluye(texto, [
    "NOTA DE CRÉDITO", "N.° 00001-26000001", "B", "COD. 008",
    "ANULA", "Factura B N.° 00001-26000001  ·  Pedido V-2026-000001  ·  emitida el 13/10/2026",
    "COBRADO EN LA VENTA ORIGINAL", "Efectivo", "$ 20.000,00", "Transferencia  ·  ref. OP-887654", "$ 25.000,00",
    "-$ 45.000,00", "TOTAL ACREDITADO", "NOTA DE CRÉDITO B · 00001-26000001", "NC-V-2026-000001",
  ]);
  assert.ok(!texto.includes("\u2212"), "el signo negativo es el guion ASCII");
  assert.equal(dto.monto, "45000.00", "el renderer no modifica el importe del DTO");
});

test("B10-2 · NC A usa el código 003 y la NC de un Ticket va sin recuadro de letra ni código", async () => {
  const base: Dto = {
    numero: "NC-V-2026-000003",
    numero_venta: "V-2026-000003",
    tipo: "NOTA_CREDITO",
    fecha_emision: "2026-10-15T18:57:00.000Z",
    monto: 1000,
    cae_simulado: "68031598279003",
    qr_data_url: await qrB7("NOTA_CREDITO", "NC-V-2026-000003", 1000, "68031598279003"),
    es_simulado: true,
  };
  const ncA = await extraerPdf(await generarComprobanteFiscalPdf({ ...base, comprobante_original: { numero: "V-2026-000003", tipo: "FACTURA_A" } }));
  incluye(ncA.texto, ["NOTA DE CRÉDITO", "COD. 003", "Factura A N.° 00001-26000003"]);
  const ncTicket = await extraerPdf(await generarComprobanteFiscalPdf({ ...base, comprobante_original: { numero: "V-2026-000003", tipo: "TICKET" } }));
  incluye(ncTicket.texto, ["NOTA DE CRÉDITO", "Ticket N.° 00001-26000003"]);
  assert.ok(!ncTicket.texto.includes("COD."), "sin código de NC para un Ticket (caso abierto)");
});

test("B10-2/4 · Ticket de mostrador a consumidor final y Factura A", async () => {
  const ticket = await extraerPdf(await generarComprobanteFiscalPdf({
    numero: "V-2026-000004",
    numero_venta: "V-2026-000004",
    tipo: "TICKET",
    fecha_emision: "2026-10-10T13:00:00.000Z",
    monto: "15000.00",
    cae_simulado: "68031598270004",
    qr_data_url: await qrB7("TICKET", "V-2026-000004", 15000, "68031598270004"),
    es_simulado: true,
    canal: "MOSTRADOR",
    cliente: { dni: null, nombre: "Consumidor final" },
    items: [{ descripcion: "Borcegos", variante: "Combate · Talle 42 · Negro · HOMBRE", sku: "BORCEG-COMBATE-42-NEGRO-H", cantidad: 1, precio_unitario: 15000 }],
    pagos: [{ medio: "TARJETA", importe: 15000, referencia: "POS-1234" }],
  }));
  incluye(ticket.texto, ["TICKET", "T", "COD. 083", "N.° 00001-26000004", "Mostrador", "Consumidor final", "Tarjeta  ·  ref. POS-1234", "TICKET T · 00001-26000004"]);
  assert.ok(!ticket.texto.includes("DNI"));

  const facturaA = await extraerPdf(await generarComprobanteFiscalPdf({ ...(await facturaWeb()), tipo: "FACTURA_A" }));
  incluye(facturaA.texto, ["FACTURA", "A", "COD. 001"]);
});

test("B10-8 · un DTO sin ítems ni pagos (el de HU-E9 antes de B10) genera el PDF sin esas secciones", async () => {
  const { texto, documento } = await extraerPdf(await generarComprobanteWebPdf({
    numero: "V-2026-000019",
    tipo: "FACTURA_B",
    fecha_emision: "2026-10-08T15:30:00.000Z",
    monto: 10000,
    cae_simulado: "12345678901234",
    qr_data_url: await QRCode.toDataURL("qr-fiscal-persistido"),
    es_simulado: true,
  }));
  assert.equal(documento.getPageCount(), 1);
  incluye(texto, [
    "SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP", "FACTURA", "COD. 006", "N.° 00001-26000019", "V-2026-000019",
    "Consumidor final", "12345678901234", "IVA contenido (21 %)", "TOTAL", "$ 10.000,00", "QR FISCAL SIMULADO",
  ]);
  for (const ausente of ["DESCRIPCIÓN", "MEDIOS DE PAGO", "Subtotal", "Descuento"]) {
    assert.ok(!texto.includes(ausente), ausente);
  }
});

test("B10-7 · el pie embebe el QR archivado tal cual (mismas dimensiones), sin regenerarlo", async () => {
  const dto = await facturaWeb();
  const ancho = Buffer.from(dto.qr_data_url.split(",")[1]!, "base64").readUInt32BE(16);
  const { documento, texto } = await extraerPdf(await generarComprobanteFiscalPdf(dto));
  assert.deepEqual(anchoImagenes(documento), [ancho]);
  incluye(texto, ["CAE simulado", "68031598270007", "Referencia interna", "V-2026-000007"]);
});

test("B10-7 · con muchos ítems la tabla sigue en otra hoja, repitiendo banda, leyenda y encabezado", async () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    descripcion: `Producto ${String(i + 1).padStart(2, "0")}`,
    variante: "Modelo · Talle M · Negro · HOMBRE",
    sku: `SKU-${i + 1}`,
    cantidad: 1,
    precio_unitario: 1000,
  }));
  const dto: Dto = { ...(await facturaWeb()), monto: 30000, items, pagos: [{ medio: "EFECTIVO", importe: 30000, referencia: null }] };
  const { documento, paginas, operadores } = await extraerPdf(await generarComprobanteFiscalPdf(dto));
  const total = documento.getPageCount();
  assert.ok(total > 1, "30 ítems no entran en una hoja");
  paginas.forEach((pagina, i) => {
    incluye(pagina, ["SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP", "N.° 00001-26000007", `Página ${i + 1} de ${total}`]);
  });
  // Cada ítem se dibuja una sola vez, en orden, y toda hoja con ítems repite el encabezado.
  const vistos = paginas.flatMap((pagina) => pagina.split("\n").filter((l) => l.startsWith("Producto ")));
  assert.deepEqual(vistos, items.map((it) => it.descripcion));
  for (const pagina of paginas.filter((p) => p.includes("Producto "))) incluye(pagina, ["DESCRIPCIÓN"]);
  // Totales y QR solo en la última hoja.
  assert.ok(paginas.at(-1)!.includes("TOTAL") && paginas.at(-1)!.includes("QR FISCAL SIMULADO"));
  for (const pagina of paginas.slice(0, -1)) assert.ok(!pagina.includes("QR FISCAL SIMULADO"));
  assert.ok(operadores.slice(0, -1).every((ops) => !/\/Image-/.test(ops)));
});

test("Errores · un QR persistido inválido lanza QrFiscalInvalidoError (nunca un PDF sin QR)", async () => {
  const dto = { ...(await facturaWeb()), qr_data_url: "data:image/png;base64,SIMULADO-SEED-NO-AFIP==" };
  await assert.rejects(generarComprobanteFiscalPdf(dto), (error: Error) => error.name === "QrFiscalInvalidoError");
});
