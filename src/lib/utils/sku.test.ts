import { test } from "node:test";
import assert from "node:assert/strict";
import { generarSku, generarEanQrPlaceholder } from "./sku.ts";

test("generarSku: combinación normal", () => {
  const sku = generarSku({
    codigoProducto: "CAMP",
    modelo: "SS3",
    talle: "L",
    codigoColor: "NEG",
    genero: "HOMBRE",
  });
  assert.equal(sku, "CAMP-SS3-L-NEG-H");
});

test("generarSku: mismos inputs producen siempre el mismo SKU (pureza)", () => {
  const params = {
    codigoProducto: "BORC",
    modelo: "TRK",
    talle: "42",
    codigoColor: "VEO",
    genero: "UNISEX" as const,
  };
  assert.equal(generarSku(params), generarSku(params));
});

test("generarSku: normaliza espacios y minúsculas a mayúsculas sin espacios", () => {
  const sku = generarSku({
    codigoProducto: " camp ",
    modelo: "ss3",
    talle: " l ",
    codigoColor: "neg",
    genero: "MUJER",
  });
  assert.equal(sku, "CAMP-SS3-L-NEG-M");
});

test("generarSku: mapea correctamente los tres códigos de género", () => {
  const base = { codigoProducto: "P", modelo: "M", talle: "T", codigoColor: "C" };
  assert.equal(generarSku({ ...base, genero: "HOMBRE" }).endsWith("-H"), true);
  assert.equal(generarSku({ ...base, genero: "MUJER" }).endsWith("-M"), true);
  assert.equal(generarSku({ ...base, genero: "UNISEX" }).endsWith("-U"), true);
});

test("generarEanQrPlaceholder: antepone PEND- al SKU en mayúsculas", () => {
  assert.equal(
    generarEanQrPlaceholder("CAMP-SS3-L-NEG-H"),
    "PEND-CAMP-SS3-L-NEG-H",
  );
});

test("generarEanQrPlaceholder: es determinístico y nunca colisiona si el SKU no colisiona", () => {
  const skuA = generarSku({
    codigoProducto: "CAMP",
    modelo: "SS3",
    talle: "L",
    codigoColor: "NEG",
    genero: "HOMBRE",
  });
  const skuB = generarSku({
    codigoProducto: "CAMP",
    modelo: "SS3",
    talle: "L",
    codigoColor: "NEG",
    genero: "MUJER",
  });
  assert.equal(generarEanQrPlaceholder(skuA), generarEanQrPlaceholder(skuA));
  assert.notEqual(generarEanQrPlaceholder(skuA), generarEanQrPlaceholder(skuB));
});

test("generarEanQrPlaceholder: normaliza minúsculas/espacios igual que el SKU", () => {
  assert.equal(
    generarEanQrPlaceholder("  camp-ss3-l-neg-h  "),
    "PEND-CAMP-SS3-L-NEG-H",
  );
});
