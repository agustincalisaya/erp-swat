import assert from "node:assert/strict";
import test from "node:test";
import { ETIQUETA_FALTANTE, evaluarPublicabilidad } from "./publicabilidad-web.reglas.ts";

/** HU-E16 (spec E §6.2, E16-1) — regla pura de publicabilidad y orden canónico de faltantes. */

test("E16-1 — descripción y al menos una foto activa: publicable, sin faltantes", () => {
  assert.deepEqual(evaluarPublicabilidad({ descripcion: "Camisa", fotos_activas: 1 }), { publicable: true, faltantes: [] });
  assert.deepEqual(evaluarPublicabilidad({ descripcion: "Camisa", fotos_activas: 5 }), { publicable: true, faltantes: [] });
});

test("E16-1 — sin descripción (vacía o de solo espacios): ['descripcion']", () => {
  assert.deepEqual(evaluarPublicabilidad({ descripcion: "", fotos_activas: 1 }), { publicable: false, faltantes: ["descripcion"] });
  assert.deepEqual(evaluarPublicabilidad({ descripcion: "  \n\t ", fotos_activas: 2 }), {
    publicable: false,
    faltantes: ["descripcion"],
  });
});

test("E16-1 — sin foto activa: ['foto']", () => {
  assert.deepEqual(evaluarPublicabilidad({ descripcion: "Camisa", fotos_activas: 0 }), { publicable: false, faltantes: ["foto"] });
});

test("E16-1 — faltan ambas: orden canónico ['descripcion', 'foto']", () => {
  assert.deepEqual(evaluarPublicabilidad({ descripcion: " ", fotos_activas: 0 }), {
    publicable: false,
    faltantes: ["descripcion", "foto"],
  });
});

test("cada faltante tiene etiqueta de UI", () => {
  for (const f of ["descripcion", "foto"] as const) assert.ok(ETIQUETA_FALTANTE[f].length > 0);
});
