import assert from "node:assert/strict";
import test from "node:test";
import { cargarAislado, cargarPdfMarca, extraerPdf } from "../ecommerce/comprobante-pdf.test-helpers.ts";
import * as presentacion from "./libro-iva.presentacion.ts";
import type { LibroIvaVista } from "./libro-iva.constants.ts";

const { generarLibroIvaPdf } = cargarAislado<{ generarLibroIvaPdf: (libro: LibroIvaVista) => Promise<Uint8Array> }>(new URL("./libro-iva.pdf.ts", import.meta.url), {
  "server-only": {}, "../ecommerce/pdf-marca": cargarPdfMarca(), "./libro-iva.presentacion": presentacion,
});
function libro(cantidad: number): LibroIvaVista {
  return { tipo: "VENTAS", periodo: "2026-10", totales: { comprobantes: cantidad, notas_credito: 1, neto: "100.00", iva: "21.00", total: "121.00" },
    filas: Array.from({ length: cantidad }, (_, i) => ({ id: String(i), fecha: "20261001", tipo: i ? "006" : "008", pv: "00001", numero: String(i).padStart(8, "0"),
      tipo_doc: "96", numero_doc: "30111222", denominacion: i === 0 ? "José Álvarez - " + "Nombre extenso ".repeat(12) : `Cliente ${i}`,
      neto: i ? "100.00" : "-100.00", iva: i ? "21.00" : "-21.00", total: i ? "121.00" : "-121.00" })) };
}

test("G4 PDF pagina todo el libro, repite encabezados y conserva nombres y totales", async () => {
  const datos = libro(60);
  const pdf = await extraerPdf(await generarLibroIvaPdf(datos));
  assert.ok(pdf.paginas.length >= 3);
  for (const pagina of pdf.paginas) {
    assert.ok(pagina.includes("Libro de IVA - Ventas"));
    assert.ok(pagina.includes("Comprobante"));
    assert.ok(pagina.includes("Página"));
  }
  assert.ok(pdf.texto.includes("José Álvarez"));
  assert.ok(pdf.texto.includes("Cliente 59"));
  assert.ok(pdf.texto.includes("-121,00"));
  assert.ok(pdf.paginas.at(-1)!.includes("TOTAL DEL PERÍODO"));
  assert.equal(pdf.documento.getTitle(), "Libro de IVA - Ventas - Octubre 2026");
  assert.equal(pdf.texto.includes("SUBCONJUNTO INTERNO"), false);
});

test("G4 PDF vacío y compra conservan estructura; presentación no pierde precisión", async () => {
  const datos = libro(0); datos.tipo = "COMPRAS";
  datos.totales = { comprobantes: 0, notas_credito: 0, neto: "0.00", iva: "0.00", total: "0.00" };
  const pdf = await extraerPdf(await generarLibroIvaPdf(datos));
  assert.equal(pdf.paginas.length, 1);
  assert.ok(pdf.texto.includes("Sin comprobantes en este período"));
  assert.ok(pdf.texto.includes("Proveedor"));
  assert.equal(presentacion.monedaLibro("9999999999999999.99"), "$ 9.999.999.999.999.999,99");
  assert.equal(presentacion.monedaLibro("-121.00"), "$ -121,00");
});
