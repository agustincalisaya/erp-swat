import assert from "node:assert/strict";
import path from "node:path";
import test, { before, mock } from "node:test";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import type { FilaListaPrecioVenta } from "./lista-precios-venta.calculo";

// La Server Action importa `server-only` (sesión/Prisma), que fuera de Next
// revienta al cargarse. El render SSR nunca la invoca: se reemplaza el módulo.
mock.module(
  pathToFileURL(path.resolve("src/app/(dashboard)/ventas/lista-precios/actions.ts")).href,
  { namedExports: { publicarVersionListaPrecioVentaAction: async () => ({ data: null, error: null }) } },
);
let EditorListaPreciosVenta: typeof import("./EditorListaPreciosVenta").EditorListaPreciosVenta;
before(async () => {
  ({ EditorListaPreciosVenta } = await import("./EditorListaPreciosVenta"));
});

/**
 * HU-B9 — render SSR del editor de `/ventas/lista-precios` (sin DOM). El
 * gating por permiso de la página se cubre en el QA con navegador real; la
 * interacción (motivo condicional, habilitado del botón) se testea sobre la
 * lógica pura en `lista-precios-venta.calculo.test.ts`.
 *
 * Correr con `node --import tsx --experimental-test-module-mocks --test` (el script `npm test` usa
 * `--experimental-strip-types`, que no procesa `.tsx` ni el alias `@/`).
 */

const FILAS: FilaListaPrecioVenta[] = [
  { variante_sku_id: "407e729d-47c3-404d-a89a-0a9c1f85a3db", sku: "CT-M-VER", descripcion: "Camisa Táctica · M/Verde", precio_vigente: 21100, costo_reposicion: 15600, precio_sugerido: 21060 },
  { variante_sku_id: "bc8d1631-2378-4c63-826f-16e2cc814eea", sku: "GOR-U-NEG", descripcion: "Gorra Táctica · U/Negro", precio_vigente: 9500, costo_reposicion: null, precio_sugerido: null },
  { variante_sku_id: "fadabd3f-991e-4e26-90f2-ad8cc97856c7", sku: "CAMPOL-M-AZU", descripcion: "Camisa de Policía · M/Azul", precio_vigente: null, costo_reposicion: null, precio_sugerido: null },
];

function render(filas: FilaListaPrecioVenta[]): string {
  // `useRouter()` del diálogo exige un App Router montado: se provee uno inerte.
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(EditorListaPreciosVenta, { filas, hoy: "2026-10-03" }),
    ),
  );
}

test("renderiza una fila por variante con precio vigente, costo y sugerencia", () => {
  const html = render(FILAS);
  for (const sku of ["CT-M-VER", "GOR-U-NEG", "CAMPOL-M-AZU"]) assert.match(html, new RegExp(sku));
  assert.match(html, /Variantes activas \(3\)/);
  assert.match(html, /Sin costo/);
  assert.match(html, /Sin precio/, "Camisa de Policía no tiene precio vigente");
  assert.equal((html.match(/Aplicar/g) ?? []).length, 1, "solo la variante con costo ofrece sugerencia");
});

test("estado inicial: inputs vacíos, sin motivo y botón Publicar deshabilitado", () => {
  const html = render(FILAS);
  assert.doesNotMatch(html, /Motivo \(precio bajo costo\)/);
  assert.match(html, /Todavía no cargaste ningún precio/);
  assert.match(html, /<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Publicar versión/);
  assert.match(html, /type="date"[^>]*value="2026-10-03"|value="2026-10-03"[^>]*type="date"/);
  assert.match(html, /min="2026-10-03"/);
  assert.match(html, /mantienen su precio\s+vigente/);
});

test("sin variantes activas: mensaje de vacío", () => {
  const html = render([]);
  assert.match(html, /No hay variantes activas para cotizar/);
});
