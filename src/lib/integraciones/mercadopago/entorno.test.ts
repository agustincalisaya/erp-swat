import assert from "node:assert/strict";
import test from "node:test";
import { seleccionarEntornoMercadoPago } from "./entorno.ts";

test("sin configuración conserva la selección por NODE_ENV", () => {
  assert.equal(seleccionarEntornoMercadoPago(undefined, "production"), "PRODUCCION");
  assert.equal(seleccionarEntornoMercadoPago("", "production"), "PRODUCCION");
  assert.equal(seleccionarEntornoMercadoPago(undefined, "development"), "SANDBOX");
});

test("permite una demo SANDBOX aunque Vercel ejecute NODE_ENV=production", () => {
  assert.equal(seleccionarEntornoMercadoPago("SANDBOX", "production"), "SANDBOX");
  assert.equal(seleccionarEntornoMercadoPago("PRODUCCION", "development"), "PRODUCCION");
});

test("un valor incorrecto no cae silenciosamente en producción", () => {
  assert.throws(() => seleccionarEntornoMercadoPago("sandbox", "production"), /MP_ENTORNO/);
});
