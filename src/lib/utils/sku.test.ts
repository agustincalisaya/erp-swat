import { test } from "node:test";
import assert from "node:assert/strict";
import { generarSku, claveCombinacionVariante } from "./sku.ts";

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

test("claveCombinacionVariante: junta talle/color/género normalizados con '|'", () => {
  assert.equal(
    claveCombinacionVariante({ talle: "L", color: "NEG", genero: "HOMBRE" }),
    "L|NEG|HOMBRE",
  );
});

test("claveCombinacionVariante: normaliza espacios y minúsculas igual que generarSku()", () => {
  assert.equal(
    claveCombinacionVariante({ talle: " l ", color: "neg", genero: "MUJER" }),
    "L|NEG|MUJER",
  );
});

test("claveCombinacionVariante: mismos inputs producen siempre la misma key (pureza)", () => {
  const params = { talle: "42", color: "VEO", genero: "UNISEX" as const };
  assert.equal(claveCombinacionVariante(params), claveCombinacionVariante(params));
});
