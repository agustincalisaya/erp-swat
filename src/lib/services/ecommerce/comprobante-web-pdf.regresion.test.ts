/**
 * Sprint 5 · Cluster 4 — regresión de la descarga de HU-E9.
 *
 * Hasta HU-G3 este archivo fijaba la salida web texto por texto. HU-B10
 * (spec_modulo_B.md §2.10) cambia ese diseño a propósito: E9 y el repositorio
 * de HU-G3 comparten un único renderer. Lo que sigue siendo cierto de E9 se
 * conserva: la firma `generarComprobanteWebPdf(comprobante)`, la ruta con su
 * sesión de Cliente Web y su loader, el 200 `application/pdf` como adjunto,
 * el 404 de un pedido ajeno y el rechazo de un QR inválido (que E9 sigue
 * respondiendo con su mapeo actual, sin cambiar códigos HTTP).
 *
 * La ruta real se ejecuta con su `response.ts` y su `http.ts` reales; solo se
 * reemplazan la sesión de Cliente Web y el loader de E9 por dobles.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import QRCode from "qrcode";
import { ServiceError } from "../../errors/service-error.ts";
import { cargarAislado, cargarComprobantePdf, extraerPdf } from "./comprobante-pdf.test-helpers.ts";

type Dto = Record<string, unknown> & { numero: string; qr_data_url: string };

const pdf = cargarComprobantePdf<{
  generarComprobanteWebPdf: (comprobante: Dto) => Promise<Uint8Array>;
  generarComprobanteFiscalPdf: (comprobante: Dto) => Promise<Uint8Array>;
}>();
const { generarComprobanteWebPdf, generarComprobanteFiscalPdf } = pdf;

const RUTA = new URL("../../../app/api/tienda/mis-pedidos/[id]/comprobante/descargar/route.ts", import.meta.url);
const CLIENTE_ID = "11111111-1111-4111-8111-111111111111";
const PEDIDO_PROPIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEDIDO_AJENO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** DTO que arma hoy `obtenerComprobanteOriginalWebCliente` (HU-E9 + campos de HU-B10). */
async function dtoWeb(qr?: string): Promise<Dto> {
  return {
    numero: "V-2026-000007",
    numero_venta: "V-2026-000007",
    tipo: "FACTURA_B",
    fecha_emision: "2026-10-13T14:24:00.000Z",
    monto: 44300,
    cae_simulado: "68031598270007",
    qr_data_url: qr ?? (await QRCode.toDataURL("qr-fiscal-persistido")),
    es_simulado: true,
    canal: "WEB",
    cliente: { dni: "30123456", nombre: "Juan Pérez" },
    items: [
      { descripcion: "Camisa Táctica", variante: "Manga Corta · Talle L · Negro · HOMBRE", sku: "CAMTAC-MANGA CORTA-L-NEGRO-H", cantidad: 1, precio_unitario: "22800.00", descuento_porcentual: null },
      { descripcion: "Camisa Táctica", variante: "Manga Larga · Talle S · Verde · MUJER", sku: "CAMTAC-MANGA LARGA-S-VERDE-M", cantidad: 1, precio_unitario: "21500.00", descuento_porcentual: null },
    ],
    pagos: [{ medio: "MERCADO_PAGO", importe: "44300.00", referencia: "1320000000007" }],
  };
}

// ── Ruta real de E9 con dobles de sesión y loader ───────────────────────────

const requireReal = createRequire(import.meta.url);
let dtoActual: Dto | null = null;
const cargasLoader: [string, string][] = [];

const http = cargarAislado<Record<string, unknown>>(new URL("../../../app/api/tienda/mis-pedidos/http.ts", import.meta.url), {
  "server-only": {},
  "@/lib/errors/service-error": { ServiceError },
});
const { NextRequest } = requireReal("next/server") as typeof import("next/server");

const { GET } = cargarAislado<{ GET: (req: unknown, context: unknown) => Promise<Response> }>(RUTA, {
  "@/lib/auth/sesion-cliente-web": {
    withSesionClienteWeb: (handler: (req: unknown, sesion: unknown, context: unknown) => Promise<Response>) =>
      async (req: unknown, context: unknown) => handler(req, { clienteId: CLIENTE_ID }, context),
  },
  "@/lib/schemas/mis-pedidos.schema": cargarAislado(new URL("../../schemas/mis-pedidos.schema.ts", import.meta.url), {}),
  "@/lib/services/ecommerce/comprobante-web-pdf": pdf,
  "@/lib/services/ecommerce/mis-pedidos.service": {
    obtenerComprobanteOriginalWebCliente: async (clienteId: string, pedidoId: string) => {
      cargasLoader.push([clienteId, pedidoId]);
      if (pedidoId !== PEDIDO_PROPIO || !dtoActual) throw new ServiceError("PEDIDO_NO_ENCONTRADO", "El pedido solicitado no existe");
      return dtoActual;
    },
  },
  "../../../http": http,
  "./response": cargarAislado(new URL("../../../app/api/tienda/mis-pedidos/[id]/comprobante/descargar/response.ts", import.meta.url), {}),
});

function descargar(pedidoId: string): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/tienda/mis-pedidos/${pedidoId}/comprobante/descargar`);
  return GET(req, { params: Promise.resolve({ id: pedidoId }) });
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("HU-E9 · la firma generarComprobanteWebPdf(comprobante) sigue intacta", () => {
  assert.equal(typeof generarComprobanteWebPdf, "function");
  assert.equal(generarComprobanteWebPdf.length, 1);
});

test("HU-E9 · la descarga de la tienda sigue usando generarComprobanteWebPdf con su loader y sesión de cliente", () => {
  const ruta = readFileSync(RUTA, "utf8");
  assert.match(ruta, /withSesionClienteWeb/);
  assert.match(ruta, /obtenerComprobanteOriginalWebCliente\(sesion\.clienteId, id\.data\)/);
  assert.match(ruta, /generarComprobanteWebPdf\(comprobante\)/);
  assert.doesNotMatch(ruta, /tesoreria|generarComprobanteFiscalPdf/);
});

test("HU-B10 · E9 y HU-G3 comparten el renderer: el PDF web es el mismo que el del repositorio", async () => {
  const dto = await dtoWeb();
  const web = await extraerPdf(await generarComprobanteWebPdf(dto));
  const repositorio = await extraerPdf(await generarComprobanteFiscalPdf(dto));
  assert.deepEqual(web.paginas, repositorio.paginas);
});

test("HU-E9 · la descarga web responde 200 con el PDF de HU-B10 (marca, ítems, pago y totales)", async () => {
  dtoActual = await dtoWeb();
  const respuesta = await descargar(PEDIDO_PROPIO);
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("content-type"), "application/pdf");
  assert.equal(respuesta.headers.get("content-disposition"), 'attachment; filename="comprobante-V-2026-000007.pdf"');
  assert.equal(respuesta.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(cargasLoader.at(-1), [CLIENTE_ID, PEDIDO_PROPIO], "el loader recibe el cliente de la sesión");

  const { texto, operadores } = await extraerPdf(new Uint8Array(await respuesta.arrayBuffer()));
  for (const dato of [
    "SIMULADO — SIN VALIDEZ FISCAL ANTE AFIP", "SWAT", "INDUMENTARIAS", "FACTURA", "COD. 006", "N.° 00001-26000007",
    "Web", "Juan Pérez", "DNI 30123456", "68031598270007", "Camisa Táctica", "Mercado Pago  ·  ref. 1320000000007",
    "IVA contenido (21 %)", "$ 44.300,00", "QR FISCAL SIMULADO",
  ]) assert.ok(texto.includes(dato), dato);
  assert.match(operadores[0]!, /\/Image-/);
});

test("HU-E9 · un pedido ajeno sigue respondiendo 404 PEDIDO_NO_ENCONTRADO", async () => {
  const respuesta = await descargar(PEDIDO_AJENO);
  assert.equal(respuesta.status, 404);
  assert.equal(((await respuesta.json()) as { error: { code: string } }).error.code, "PEDIDO_NO_ENCONTRADO");
});

test("HU-E9 · un QR archivado inválido nunca produce un PDF: la ruta conserva su respuesta de error (500)", async () => {
  dtoActual = await dtoWeb("data:image/png;base64,SIMULADO-SEED-NO-AFIP==");
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const respuesta = await descargar(PEDIDO_PROPIO);
    assert.equal(respuesta.status, 500);
    assert.notEqual(respuesta.headers.get("content-type"), "application/pdf");
  } finally {
    console.error = errorOriginal;
  }
});

test("HU-E9 · un PNG corrupto con prefijo válido también se rechaza (nunca un PDF sin QR)", async () => {
  await assert.rejects(generarComprobanteWebPdf(await dtoWeb("data:image/png;base64,AAAA")), /no es una imagen PNG válida/);
});

test("HU-E9 · rechaza un QR persistido que no es PNG (el placeholder que tenía el seed)", async () => {
  await assert.rejects(
    generarComprobanteWebPdf(await dtoWeb("data:image/png;base64,SIMULADO-SEED-NO-AFIP==")),
    /no es una imagen PNG válida/,
  );
});
