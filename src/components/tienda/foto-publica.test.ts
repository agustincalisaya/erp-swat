import assert from "node:assert/strict";
import test from "node:test";
import { fotoPublicaProducto } from "./foto-publica.ts";

test("fotoPublicaProducto conserva la foto administrada y descarta placeholders", () => {
  assert.equal(fotoPublicaProducto("/api/tienda/fotos/producto/1"), "/api/tienda/fotos/producto/1");
  assert.equal(fotoPublicaProducto("https://cdn.ejemplo.com/camisa.webp"), "https://cdn.ejemplo.com/camisa.webp");
  assert.equal(fotoPublicaProducto("https://placehold.co/600x800"), null);
  assert.equal(fotoPublicaProducto(null), null);
});
