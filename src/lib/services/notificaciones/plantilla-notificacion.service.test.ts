import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `plantilla-notificacion.service.ts` (HU-F2, task §7
 * Nivel 1) — mismo patrón que `lista-precio-venta.service.test.ts`: el
 * servicio usa `import "server-only"`. El comportamiento real se verifica
 * contra la base local descartable en `plantilla-notificacion.http.integration.test.ts`.
 */

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const fuente = leer("./plantilla-notificacion.service.ts");

function funcion(nombre: string): string {
  const inicio = fuente.indexOf(`export async function ${nombre}`);
  assert.ok(inicio > -1, `no se encontró ${nombre}`);
  const fin = fuente.indexOf("\n// ──", inicio + 10);
  return fuente.slice(inicio, fin === -1 ? undefined : fin);
}

const RUTAS = {
  alta: "../../../app/api/notificaciones/plantillas/route.ts",
  edicion: "../../../app/api/notificaciones/plantillas/[id]/route.ts",
  baja: "../../../app/api/notificaciones/plantillas/[id]/baja/route.ts",
  reactivar: "../../../app/api/notificaciones/plantillas/[id]/reactivar/route.ts",
};
const ACTIONS = "../../../app/(dashboard)/administracion/notificaciones/actions.ts";

const crear = funcion("crearPlantillaNotificacion");
const reactivar = funcion("reactivarPlantillaNotificacion");
const editar = funcion("editarPlantillaNotificacion");
const baja = funcion("darDeBajaPlantillaNotificacion");

test("sin DELETE físico: nunca delete/deleteMany", () => {
  assert.doesNotMatch(fuente, /plantillaNotificacion\.delete(Many)?\s*\(/);
});

test("el permiso es notificaciones:administrar_plantillas", () => {
  assert.match(
    fuente,
    /PERMISO_ADMINISTRAR_PLANTILLAS = "notificaciones:administrar_plantillas"/,
  );
});

test("alta: valida tipo_evento antes de escribir (422 TIPO_EVENTO_DESCONOCIDO)", () => {
  assert.ok(crear.indexOf("TIPO_EVENTO_DESCONOCIDO") < crear.indexOf(".create("));
});

test("alta: traduce P2002 a PLANTILLA_YA_EXISTE / PLANTILLA_DADA_DE_BAJA según is_active", () => {
  assert.match(crear, /esP2002\(error\)/);
  assert.match(fuente, /error\.code === "P2002"/);
  assert.match(crear, /PLANTILLA_DADA_DE_BAJA[\s\S]*\/reactivar/);
  assert.match(crear, /PLANTILLA_YA_EXISTE/);
});

for (const [nombre, cuerpo, evento] of [
  ["alta", crear, "notificacion_plantilla:creada"],
  ["reactivación", reactivar, "notificacion_plantilla:reactivada"],
  ["edición", editar, "notificacion_plantilla:actualizada"],
  ["baja", baja, "notificacion_plantilla:baja_logica"],
] as const) {
  test(`${nombre}: emite ${evento} post-COMMIT (después de la escritura y fuera del $transaction)`, () => {
    const emit = cuerpo.indexOf(`domainEventBus.emit("${evento}"`);
    assert.ok(emit > -1, "no emite el evento");
    const escritura = Math.max(cuerpo.indexOf(".create("), cuerpo.indexOf(".updateMany("));
    assert.ok(escritura > -1 && escritura < emit, "emite antes de escribir");
    const finTransaccion = cuerpo.indexOf("\n  });");
    if (cuerpo.includes("$transaction")) {
      assert.ok(finTransaccion > -1 && finTransaccion < emit, "emite dentro del $transaction");
    }
  });
}

test("baja: updateMany con guarda is_active: true y los 4 campos de soft delete", () => {
  assert.match(baja, /updateMany\(\{\s*where: \{ id: plantillaId, is_active: true \}/);
  for (const campo of ["is_active: false", "deleted_at: ahora", "deleted_by: usuarioId", "deletion_reason:"]) {
    assert.ok(baja.includes(campo), campo);
  }
  assert.match(baja, /PLANTILLA_YA_DADA_DE_BAJA/);
});

test("reactivación: updateMany con guarda is_active: false y limpia los campos de baja", () => {
  assert.match(reactivar, /updateMany\(\{\s*where: \{ id: plantillaId, is_active: false \}/);
  assert.match(
    reactivar,
    /is_active: true, deleted_at: null, deleted_by: null, deletion_reason: null/,
  );
  assert.match(reactivar, /PLANTILLA_YA_ACTIVA/);
});

test("edición: guarda is_active: true y rechaza dada de baja con PLANTILLA_DADA_DE_BAJA", () => {
  assert.match(editar, /updateMany\(\{\s*where: \{ id: plantillaId, is_active: true \}/);
  assert.match(editar, /PLANTILLA_DADA_DE_BAJA/);
  assert.doesNotMatch(editar, /tipo_evento: input/);
});

test("obtenerPlantillaActivaPorEvento filtra is_active y deleted_at (contrato HU-F3)", () => {
  assert.match(
    funcion("obtenerPlantillaActivaPorEvento"),
    /where: \{ tipo_evento: tipoEvento, is_active: true, deleted_at: null \}/,
  );
});

test("TIPOS_EVENTO_DECLARADOS_SPRINT_4 rotulada PROPUESTA y con nota de borrado", () => {
  const bloque = fuente.slice(0, fuente.indexOf("const TIPOS_EVENTO_DECLARADOS_SPRINT_4"));
  assert.match(bloque.slice(-1200), /PROPUESTA/);
  assert.match(bloque.slice(-1200), /BORRAR/);
});

test("Route Handlers: wrappers finos con el permiso, sin prisma", () => {
  for (const [nombre, ruta] of Object.entries(RUTAS)) {
    const src = leer(ruta);
    assert.match(src, /withPermission\(\s*PERMISO_ADMINISTRAR_PLANTILLAS/, nombre);
    assert.doesNotMatch(src, /prisma/, nombre);
    assert.doesNotMatch(src, /domainEventBus/, nombre);
  }
});

test("Server Actions: verifican el permiso y no usan prisma", () => {
  const src = leer(ACTIONS);
  assert.match(src, /^"use server";/);
  assert.match(src, /usuarioTienePermiso\(session\.userId, PERMISO_ADMINISTRAR_PLANTILLAS\)/);
  assert.doesNotMatch(src, /prisma/);
  for (const accion of [
    "crearPlantillaNotificacionAction",
    "editarPlantillaNotificacionAction",
    "darDeBajaPlantillaNotificacionAction",
    "reactivarPlantillaNotificacionAction",
  ]) {
    assert.match(src, new RegExp(`export async function ${accion}\\(`), accion);
  }
});
