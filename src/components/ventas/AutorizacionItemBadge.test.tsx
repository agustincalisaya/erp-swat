import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AutorizacionItemBadge } from "./AutorizacionItemBadge";

/**
 * Los 3 estados reales del par `requiere_autorizacion`/`autorizado_por_id`
 * (HU-B4, spec_modulo_B.md §2.4). Render SSR — sin DOM.
 *
 * Correr con `node --import tsx --test` (el script `npm test` usa
 * `--experimental-strip-types`, que no procesa `.tsx` ni el alias `@/`).
 */

function render(requiereAutorizacion: boolean, autorizadoPorId: string | null): string {
  return renderToStaticMarkup(
    createElement(AutorizacionItemBadge, { requiereAutorizacion, autorizadoPorId }),
  );
}

test("sin autorización pendiente ni resuelta: no renderiza badge", () => {
  assert.equal(render(false, null), "");
});

test("autorización pendiente: badge 'Pendiente de autorización'", () => {
  const html = render(true, null);
  assert.match(html, /Pendiente de autorización/);
  assert.doesNotMatch(html, /Autorizado/);
});

test("autorización resuelta (requiere=false, autorizado_por_id no nulo): badge 'Autorizado'", () => {
  const html = render(false, "usr_123");
  assert.match(html, /Autorizado/);
  assert.doesNotMatch(html, /Pendiente/);
});
