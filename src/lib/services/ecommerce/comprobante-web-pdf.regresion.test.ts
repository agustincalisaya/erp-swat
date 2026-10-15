/**
 * Sprint 5 · Cluster 4 — regresión de HU-E9 para la generalización de HU-G3.
 *
 * `comprobante-web-pdf.test.ts` importa el módulo directo y `server-only`
 * revienta bajo `node --experimental-strip-types`, así que no corre en
 * `npm test`. Este archivo carga el mismo módulo con `server-only` aislado
 * (patrón de reporte-mensual.service.test.ts) para que la firma que usa
 * HU-E9 quede cubierta en `npm test` mientras el Cluster 4 lo generaliza.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import QRCode from "qrcode";
import { ModuleKind, transpileModule } from "typescript";

interface ModuloPdf {
  generarComprobanteWebPdf: (comprobante: {
    numero: string;
    tipo: "FACTURA_A" | "FACTURA_B" | "TICKET" | "NOTA_CREDITO";
    fecha_emision: string;
    monto: number;
    cae_simulado: string;
    qr_data_url: string;
    es_simulado: boolean;
  }) => Promise<Uint8Array>;
}

function cargarModuloPdf(): ModuloPdf {
  const requireReal = createRequire(import.meta.url);
  const ruta = "./comprobante-web-pdf.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: Record<string, unknown> } = { exports: {} };
  const ejecutar = runInThisContext(`(function(require, module, exports) {\n${codigo}\n})`, { filename: ruta });
  ejecutar(
    (nombre: string) => {
      if (nombre === "server-only") return {};
      if (nombre.startsWith(".") || nombre.startsWith("@/")) throw new Error(`Dependencia inesperada: ${nombre}`);
      return requireReal(nombre);
    },
    modulo,
    modulo.exports,
  );
  return modulo.exports as unknown as ModuloPdf;
}

const { generarComprobanteWebPdf } = cargarModuloPdf();

async function textoPdf(bytes: Uint8Array): Promise<{ texto: string; operadores: string }> {
  const documento = await PDFDocument.load(bytes);
  assert.equal(documento.getPageCount(), 1);
  const contents = documento.getPage(0).node.Contents();
  assert.ok(contents);
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const operadores = refs
    .map((ref) => {
      const stream = documento.context.lookup(ref);
      assert.ok(stream instanceof PDFRawStream);
      return inflateSync(stream.getContents()).toString("latin1");
    })
    .join("\n");
  const texto = [...operadores.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((m) => Buffer.from(m[1]!, "hex").toString("latin1").replace(/\x97/g, "—"))
    .join("\n");
  return { texto, operadores };
}

test("HU-E9 · la firma generarComprobanteWebPdf(comprobante) sigue intacta", () => {
  assert.equal(typeof generarComprobanteWebPdf, "function");
  assert.equal(generarComprobanteWebPdf.length, 1);
});

test("HU-E9 · el DTO web actual (sin canal ni cliente) sigue generando el PDF con CAE, QR y leyenda", async () => {
  const bytes = await generarComprobanteWebPdf({
    numero: "V-2026-000019",
    tipo: "FACTURA_B",
    fecha_emision: "2026-10-08T15:30:00.000Z",
    monto: 10000,
    cae_simulado: "12345678901234",
    qr_data_url: await QRCode.toDataURL("qr-fiscal-persistido"),
    es_simulado: true,
  });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  const { texto, operadores } = await textoPdf(bytes);
  for (const dato of [
    "SWAT Indumentarias", "Comprobante fiscal", "Comprobante simulado — sin integración ni validación real con AFIP",
    "FACTURA B", "V-2026-000019", "08/10/2026", "10.000,00", "12345678901234", "QR fiscal simulado",
  ]) assert.ok(texto.includes(dato), dato);
  assert.match(operadores, /\/Image-/);
});

test("HU-E9 · rechaza un QR persistido que no es PNG (el placeholder que tenía el seed)", async () => {
  await assert.rejects(
    generarComprobanteWebPdf({
      numero: "V-2026-000001",
      tipo: "FACTURA_B",
      fecha_emision: "2026-10-08T15:30:00.000Z",
      monto: 45000,
      cae_simulado: "68031598274563",
      qr_data_url: "data:image/png;base64,SIMULADO-SEED-NO-AFIP==",
      es_simulado: true,
    }),
    /no es una imagen PNG válida/,
  );
});
