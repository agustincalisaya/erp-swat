import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";

const baseUrl = process.env.HU_E9_DOWNLOAD_BASE_URL;
const cookiePropio = process.env.HU_E9_DOWNLOAD_COOKIE_PROPIO;
const cookiePendiente = process.env.HU_E9_DOWNLOAD_COOKIE_PENDIENTE;
const pedidoPropio = process.env.HU_E9_DOWNLOAD_PEDIDO_PROPIO;
const pedidoAjeno = process.env.HU_E9_DOWNLOAD_PEDIDO_AJENO;
const pedidoSinComprobante = process.env.HU_E9_DOWNLOAD_PEDIDO_SIN_COMPROBANTE;
const uuidInexistente = "00000000-0000-4000-8000-000000000000";
const habilitado = Boolean(baseUrl && cookiePropio && cookiePendiente && pedidoPropio && pedidoAjeno && pedidoSinComprobante);

function url(id: string) {
  return `${baseUrl}/api/tienda/mis-pedidos/${id}/comprobante/descargar`;
}

async function contenidoPdf(bytes: Uint8Array) {
  const documento = await PDFDocument.load(bytes);
  const pagina = documento.getPage(0);
  const contents = pagina.node.Contents();
  assert.ok(contents);
  const referencias = contents instanceof PDFArray ? contents.asArray() : [contents];
  return referencias.map((referencia) => {
    const stream = documento.context.lookup(referencia);
    assert.ok(stream instanceof PDFRawStream);
    return [...inflateSync(stream.getContents()).toString("latin1").matchAll(/<([0-9A-F]+)> Tj/g)]
      .map((match) => Buffer.from(match[1]!, "hex").toString("latin1"))
      .join("\n");
  }).join("\n");
}

test("descarga HU-E9 sin sesión responde 401 y no se cachea", { skip: !baseUrl }, async () => {
  const respuesta = await fetch(url(uuidInexistente));
  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.headers.get("cache-control"), "private, no-store");
});

test("descarga HU-E9 usa sesión web y conserva el RBAC HU-B7", { skip: !habilitado }, async (t) => {
  const headers = { Cookie: cookiePropio! };
  const propio = await fetch(url(pedidoPropio!), { headers });
  await t.test("pedido propio: PDF adjunto, privado y con datos fiscales", async () => {
    assert.equal(propio.status, 200);
    assert.equal(propio.headers.get("content-type"), "application/pdf");
    assert.match(propio.headers.get("content-disposition") ?? "", /^attachment; filename="comprobante-[A-Za-z0-9-]+\.pdf"$/);
    assert.equal(propio.headers.get("cache-control"), "private, no-store");
    const bytes = new Uint8Array(await propio.arrayBuffer());
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
    const texto = await contenidoPdf(bytes);
    for (const dato of ["SWAT Indumentarias", "Comprobante fiscal", "CAE simulado", "QR fiscal simulado"]) {
      assert.ok(texto.includes(dato), dato);
    }
  });
  await t.test("ajeno, inexistente y sin comprobante tienen el mismo 404", async () => {
    const respuestas = await Promise.all([pedidoAjeno!, uuidInexistente, pedidoSinComprobante!]
      .map((id) => fetch(url(id), { headers })));
    const cuerpos = await Promise.all(respuestas.map((respuesta) => respuesta.text()));
    assert.ok(respuestas.every((respuesta) => respuesta.status === 404));
    assert.ok(respuestas.every((respuesta) => respuesta.headers.get("cache-control") === "private, no-store"));
    assert.ok(cuerpos.every((cuerpo) => cuerpo === cuerpos[0]));
  });
  await t.test("sin sesión 401 y cuenta pendiente 403", async () => {
    const sinSesion = await fetch(url(pedidoPropio!));
    const pendiente = await fetch(url(pedidoPropio!), { headers: { Cookie: cookiePendiente! } });
    assert.equal(sinSesion.status, 401);
    assert.equal(pendiente.status, 403);
    assert.equal(sinSesion.headers.get("cache-control"), "private, no-store");
    assert.equal(pendiente.headers.get("cache-control"), "private, no-store");
  });
  await t.test("la ruta interna B7 no acepta la sesión de Cliente Web", async () => {
    const interno = await fetch(`${baseUrl}/api/ventas/comprobantes/${uuidInexistente}`, { headers });
    assert.equal(interno.status, 401);
  });
});
