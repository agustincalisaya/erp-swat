/**
 * HU-D8 T04 — vista "Mi historial" (docs/modulos/modulo D/HU8_TASKS.md).
 * Asserts sobre la fuente (molde de `catalogo-web-admin.e16.test.ts`): los
 * componentes usan el router de Next y alias `@/`, que Node no carga fuera del
 * bundler. El comportamiento del servidor está en `hu-d8.integration.test.ts`
 * y `hu-d8.http.integration.test.ts`.
 *
 *   node --experimental-strip-types --test src/components/auditoria/historial-propio.ui.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

const pagina = leer("../../app/(dashboard)/auditoria/mi-historial/page.tsx");
const tabla = leer("./TablaHistorialPropio.tsx");
const filtros = leer("./FiltrosHistorialPropio.tsx");
const sidebar = leer("../layout/Sidebar.tsx");
const consola = leer("../../app/(dashboard)/auditoria/logs/page.tsx");

test("D8-1 — la página toma el usuario de la sesión, nunca de la URL", () => {
  assert.match(pagina, /listarHistorialPropio\(filtros, session\.userId\)/);
  assert.match(pagina, /listarAccionesPropias\(session\.userId\)/);
  assert.doesNotMatch(pagina, /usuario_id/);
});

test("D8-6/D8-7 — sin verificación de cadena, exportación, buscador de usuarios ni detalle forense", () => {
  for (const fuente of [pagina, tabla, filtros]) {
    assert.doesNotMatch(fuente, /BotonVerificarCadena|BuscadorUsuarios|listarUsuariosParaFiltro|ComboboxFiltrable/);
    assert.doesNotMatch(fuente, /[Ee]xportar|\.csv|verificar-cadena/);
  }
  assert.doesNotMatch(tabla, /valor_anterior|valor_nuevo|registro\.ip|usuario_nombre|usuario_id|hash_/);
});

test("C4 — la tabla muestra fecha/hora ART, acción, entidad e ID de registro", () => {
  assert.match(tabla, /formatearFechaHoraNegocio\(registro\.created_at\)/);
  for (const columna of ["Fecha y hora", "Acción", "Entidad", "ID de registro"]) assert.match(tabla, new RegExp(columna));
  assert.match(tabla, /registro\.accion/);
  assert.match(tabla, /registro\.tabla_afectada/);
  assert.match(tabla, /registro\.registro_id/);
});

test("D8-7 — los filtros no tienen campo de usuario y navegan a la vista propia", () => {
  assert.doesNotMatch(filtros, /usuario_id|userId|id="[^"]*usuario|setUsuario/i);
  assert.match(filtros, /const RUTA = "\/auditoria\/mi-historial";/);
  assert.match(filtros, /fecha_desde/);
  assert.match(filtros, /fecha_hasta/);
  assert.match(filtros, /"accion"/);
});

test("D8-5 — el ítem 'Mi historial' del Sidebar no tiene permiso", () => {
  assert.match(sidebar, /\{ label: "Mi historial", href: "\/auditoria\/mi-historial", icon: History \}/);
});

test("D8-1 — /auditoria/logs sin permiso forense redirige a la vista propia antes de consultar", () => {
  const posRedirect = consola.indexOf('redirect(query ? `/auditoria/mi-historial?${query}` : "/auditoria/mi-historial")');
  const posGuard = consola.indexOf("if (!tieneLeerForense) {");
  const posConsulta = consola.indexOf("await listarAuditLog(filtros, session)");
  assert.ok(posGuard >= 0 && posRedirect > posGuard && posConsulta > posRedirect, JSON.stringify({ posGuard, posRedirect, posConsulta }));
});
