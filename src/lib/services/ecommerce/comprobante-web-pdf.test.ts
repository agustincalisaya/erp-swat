import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import QRCode from "qrcode";
import { generarComprobanteWebPdf } from "./comprobante-web-pdf.ts";

test("PDF descargable contiene los datos B7 persistidos y el QR fiscal", async () => {
  const qr = await QRCode.toDataURL("qr-fiscal-persistido");
  const bytes = await generarComprobanteWebPdf({
    numero: "V-2026-000019",
    tipo: "FACTURA_B",
    fecha_emision: "2026-10-08T15:30:00.000Z",
    monto: 10000,
    cae_simulado: "12345678901234",
    qr_data_url: qr,
    es_simulado: true,
  });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");

  const documento = await PDFDocument.load(bytes);
  assert.equal(documento.getPageCount(), 1);
  const pagina = documento.getPage(0);
  const contents = pagina.node.Contents();
  assert.ok(contents);
  const referencias = contents instanceof PDFArray ? contents.asArray() : [contents];
  const operadores = referencias.map((referencia) => {
    const stream = documento.context.lookup(referencia);
    assert.ok(stream instanceof PDFRawStream);
    return inflateSync(stream.getContents()).toString("latin1");
  }).join("\n");
  const textos = [...operadores.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((match) => Buffer.from(match[1]!, "hex").toString("latin1").replace(/\x97/g, "—"));
  const contenido = textos.join("\n");
  for (const dato of [
    "SWAT Indumentarias", "Comprobante fiscal", "Comprobante simulado — sin integración ni validación real con AFIP",
    "FACTURA B", "V-2026-000019", "08/10/2026", "10.000,00", "12345678901234", "QR fiscal simulado",
  ]) assert.ok(contenido.includes(dato), dato);
  assert.match(operadores, /\/Image-/);
});
