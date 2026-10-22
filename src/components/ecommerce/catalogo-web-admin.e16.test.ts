/**
 * HU-E16 — backoffice del catálogo web (docs/modulos/modulo E/HU16_TASKS.md T05).
 * Asserts sobre la fuente (mismo molde que `cancelar-pedido-web.test.ts` y
 * `checkout-e15.test.tsx`): el componente usa el router de Next y `next/image`,
 * que Node no carga fuera del bundler. El comportamiento del servidor está en
 * `hu-e16.integration.test.ts` y `hu-e16.http.integration.test.ts`.
 *
 *   node --experimental-strip-types --test src/components/ecommerce/catalogo-web-admin.e16.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fuente = readFileSync(new URL("./CatalogoWebAdmin.tsx", import.meta.url), "utf8");
const pagina = readFileSync(new URL("../../app/(dashboard)/ecommerce/catalogo/page.tsx", import.meta.url), "utf8");

test("E16-2 — la fila recibe publicable y faltantes del servidor; la página los propaga sin recalcular", () => {
  assert.match(fuente, /publicable: boolean;\s*faltantes: FaltantePublicacion\[\];/);
  assert.match(pagina, /items: pagina\.items\.map\(\(fila\) => \(\{\s*\.\.\.fila,/);
});

test("E16-2 — «Mostrar en tienda» se deshabilita si no es publicable y muestra el motivo", () => {
  assert.match(fuente, /disabled=\{!fila\.visibilidad_web && !fila\.publicable\}/);
  assert.match(fuente, /aria-describedby=\{!fila\.visibilidad_web && !fila\.publicable \? `motivo-no-publicable-\$\{fila\.producto_web_id\}`/);
  assert.match(fuente, /No se puede mostrar en la tienda: \{textoFaltantes\(fila\.faltantes\)\}/);
});

test("E16-2 — «Ocultar en tienda» no depende de la publicabilidad", () => {
  // La única condición de `disabled` del botón de visibilidad exige que esté oculto.
  const disabled = [...fuente.matchAll(/disabled=\{([^}]*publicable[^}]*)\}/g)].map((m) => m[1]);
  assert.deepEqual(disabled, ["!fila.visibilidad_web && !fila.publicable"]);
});

test("E16-3 — visible que dejó de ser publicable: badge «No publicable» con los faltantes", () => {
  assert.match(fuente, /\{fila\.visibilidad_web && !fila\.publicable && <Badge variant="destructive">No publicable<\/Badge>\}/);
  assert.match(fuente, /\{textoFaltantes\(fila\.faltantes\)\}\. La tienda no lo muestra hasta completar el contenido\./);
});

test("E16-4 — 422 por carrera: muestra los faltantes del servidor, bloquea el reintento y refresca", () => {
  assert.match(fuente, /json\.error\?\.code === "CONTENIDO_NO_PUBLICABLE"/);
  assert.match(fuente, /json\.error\.details\?\.faltantes/);
  assert.match(fuente, /setRechazado\(true\);\s*onDesactualizado\(\);/);
  assert.match(fuente, /disabled=\{enviando \|\| rechazado\}/);
  assert.match(fuente, /onDesactualizado=\{\(\) => router\.refresh\(\)\}/);
});

test("E16-4 — 503: muestra el mensaje del servidor sin declarar éxito", () => {
  const bloque = fuente.slice(fuente.indexOf("if (!ok) {"), fuente.indexOf("onHecho(nueva ?"));
  assert.match(bloque, /setError\(mensajeDe\(json, "motivo"\)\);\s*return;/);
});

test("la UI no recalcula la publicabilidad (sin trim ni conteo de fotos para decidir)", () => {
  assert.doesNotMatch(fuente, /import \{[^}]*evaluarPublicabilidad/);
  assert.doesNotMatch(fuente, /evaluarPublicabilidad\(/);
  assert.doesNotMatch(fuente, /descripcion\.trim\(\)/);
  // (`fotos_activas === 1` existente solo elige "foto"/"fotos" en el badge.)
  assert.doesNotMatch(fuente, /fotos_activas\s*(<|>|===?\s*0|!==?\s*0)/);
});
