import assert from "node:assert/strict";
import test from "node:test";
import { respuestaComprobantePdf } from "./[id]/comprobante/descargar/response.ts";

test("respuesta de descarga es un PDF adjunto privado con nombre seguro", async () => {
  const pdf = new Uint8Array(Buffer.from("%PDF-prueba"));
  const respuesta = respuestaComprobantePdf(pdf, "V-2026-000019");
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("content-type"), "application/pdf");
  assert.equal(respuesta.headers.get("content-disposition"), 'attachment; filename="comprobante-V-2026-000019.pdf"');
  assert.equal(respuesta.headers.get("cache-control"), "private, no-store");
  assert.equal(respuesta.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await respuesta.arrayBuffer()), pdf);

  const nombreManipulado = respuestaComprobantePdf(pdf, "../../otro\r\nSet-Cookie: secreto");
  assert.doesNotMatch(nombreManipulado.headers.get("content-disposition") ?? "", /\.\.|\r|\n|Set-Cookie:/);
});
