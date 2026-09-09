import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  GenerarVariantesMatrizSchema,
  EditarVarianteOperativaSchema,
} from "./inventario.schema.ts";
import { claveCombinacionVariante } from "../utils/sku.ts";

// task_proveedor_obligatorio_variante_sku — Nivel 1 (unitario)
// El proveedor habitual es obligatorio y POR COMBINACIÓN en el alta de
// variantes (Matriz de Variantes). En la edición (§2.7) sigue siendo opcional
// de omitir. La regla "solo HOMOLOGADO" vive en la capa de servicios.

const PM = "11111111-1111-4111-8111-111111111111";
const PROV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function payloadBase() {
  return {
    producto_maestro_id: PM,
    modelo: "SS3",
    talles: ["M", "L"],
    colores: ["NEGRO"],
    generos: ["HOMBRE"] as const,
  };
}

function proveedorPorCombinacionCompleto(proveedorId = PROV_A) {
  const { talles, colores, generos } = payloadBase();
  const map: Record<string, string> = {};
  for (const talle of talles) {
    for (const color of colores) {
      for (const genero of generos) {
        map[claveCombinacionVariante({ talle, color, genero })] = proveedorId;
      }
    }
  }
  return map;
}

test("GenerarVariantesMatrizSchema: acepta un payload con proveedor por cada combinación", () => {
  const res = GenerarVariantesMatrizSchema.safeParse({
    ...payloadBase(),
    proveedor_por_combinacion: proveedorPorCombinacionCompleto(),
  });
  assert.equal(res.success, true);
});

test("GenerarVariantesMatrizSchema: rechaza si falta el campo proveedor_por_combinacion", () => {
  const res = GenerarVariantesMatrizSchema.safeParse(payloadBase());
  assert.equal(res.success, false);
});

test("GenerarVariantesMatrizSchema: rechaza si alguna combinación generada no tiene proveedor", () => {
  const completo = proveedorPorCombinacionCompleto();
  const claves = Object.keys(completo);
  // Saca una combinación → queda incompleto respecto del cartesiano.
  delete completo[claves[0]];

  const res = GenerarVariantesMatrizSchema.safeParse({
    ...payloadBase(),
    proveedor_por_combinacion: completo,
  });
  assert.equal(res.success, false);
  if (!res.success) {
    assert.deepEqual(res.error.issues[0]?.path, ["proveedor_por_combinacion"]);
  }
});

test("GenerarVariantesMatrizSchema: rechaza un proveedor_id que no es UUID", () => {
  const res = GenerarVariantesMatrizSchema.safeParse({
    ...payloadBase(),
    proveedor_por_combinacion: {
      [claveCombinacionVariante({ talle: "M", color: "NEGRO", genero: "HOMBRE" })]: "no-es-uuid",
      [claveCombinacionVariante({ talle: "L", color: "NEGRO", genero: "HOMBRE" })]: PROV_B,
    },
  });
  assert.equal(res.success, false);
});

test("GenerarVariantesMatrizSchema: admite un proveedor distinto por combinación", () => {
  const res = GenerarVariantesMatrizSchema.safeParse({
    ...payloadBase(),
    proveedor_por_combinacion: {
      [claveCombinacionVariante({ talle: "M", color: "NEGRO", genero: "HOMBRE" })]: PROV_A,
      [claveCombinacionVariante({ talle: "L", color: "NEGRO", genero: "HOMBRE" })]: PROV_B,
    },
  });
  assert.equal(res.success, true);
});

test("EditarVarianteOperativaSchema: sin cambios — sigue aceptando body vacío (PATCH parcial)", () => {
  assert.equal(EditarVarianteOperativaSchema.safeParse({}).success, true);
});

test("EditarVarianteOperativaSchema: acepta proveedor_id UUID y rechaza null / vacío / no-UUID", () => {
  assert.equal(EditarVarianteOperativaSchema.safeParse({ proveedor_id: PROV_A }).success, true);
  assert.equal(EditarVarianteOperativaSchema.safeParse({ proveedor_id: "" }).success, false);
  assert.equal(EditarVarianteOperativaSchema.safeParse({ proveedor_id: null }).success, false);
  assert.equal(EditarVarianteOperativaSchema.safeParse({ proveedor_id: "abc" }).success, false);
});

// ── Guard "solo HOMOLOGADO" en la capa de servicios (análisis estático del
//    fuente — los servicios importan "server-only" y no corren en Node) ──────

const productoServiceSrc = readFileSync(
  new URL("../services/inventario/producto.service.ts", import.meta.url),
  "utf8",
);
const varianteServiceSrc = readFileSync(
  new URL("../services/inventario/variante.service.ts", import.meta.url),
  "utf8",
);
const seedSrc = readFileSync(new URL("../../../prisma/seed.ts", import.meta.url), "utf8");

test("producto.service: generarVariantesMatriz valida proveedor existente + activo + HOMOLOGADO", () => {
  assert.match(productoServiceSrc, /PROVEEDOR_NO_ENCONTRADO/);
  assert.match(productoServiceSrc, /PROVEEDOR_NO_HOMOLOGADO/);
  assert.match(productoServiceSrc, /estado !== "HOMOLOGADO"/);
  // Resuelve proveedor_id por combinación desde el map del payload.
  assert.match(productoServiceSrc, /proveedor_por_combinacion\[clave\]/);
});

test("variante.service: editarVarianteOperativa exige HOMOLOGADO además de activo", () => {
  assert.match(varianteServiceSrc, /PROVEEDOR_NO_HOMOLOGADO/);
  assert.match(varianteServiceSrc, /estado !== "HOMOLOGADO"/);
});

test("seed: proveedorHomologado se crea antes de la primera variante y las variantes nacen con proveedor_id", () => {
  const idxProveedor = seedSrc.indexOf("const proveedorHomologado = await prisma.proveedor.upsert");
  const idxPrimeraVariante = seedSrc.indexOf("const varianteSku = await prisma.varianteSKU.upsert");
  assert.ok(idxProveedor > -1 && idxPrimeraVariante > -1);
  assert.ok(
    idxProveedor < idxPrimeraVariante,
    "proveedorHomologado debe crearse antes de la primera VarianteSKU",
  );
  assert.match(seedSrc, /proveedor_id: proveedorHomologado\.id/);
  // Ya no debe existir el paso de UPDATE posterior que planteaba v3.
  assert.doesNotMatch(seedSrc, /varianteSKU\.updateMany\(\s*\{\s*where:\s*\{\s*id:\s*\{\s*in:/);
});
