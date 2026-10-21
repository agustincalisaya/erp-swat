import assert from "node:assert/strict";
import test from "node:test";
import { ConfirmacionesPublicacionWeb, PLAZO_CONFIRMACION_RECHAZO_MS } from "./publicacion-web-confirmacion.ts";

/** HU-E16 (spec E §6.2, E16-4) — coordinador de confirmación del rechazo de publicación. */

test("E16 confirmaciones: concurrencia, limpieza, timeout, duplicado y respuestas tardías", async () => {
  const r = new ConfirmacionesPublicacionWeb();
  const a = r.esperar("a", 100);
  const b = r.esperar("b", 100);
  assert.throws(() => r.esperar("a"));
  r.confirmar("b", false);
  r.confirmar("a", true);
  assert.equal(await a.resultado, true);
  assert.equal(await b.resultado, false);
  const vencida = r.esperar("vieja", 5);
  assert.equal(await vencida.resultado, false);
  const nueva = r.esperar("nueva", 100);
  r.confirmar("vieja", true);
  assert.equal(r.cantidadPendiente, 1);
  nueva.cancelar();
  assert.equal(await nueva.resultado, false);
  assert.equal(r.cantidadPendiente, 0);
});

test("E16 confirmaciones: plazo por defecto de 10 s, sobrescribible solo en la instancia", async () => {
  const r = new ConfirmacionesPublicacionWeb();
  assert.equal(PLAZO_CONFIRMACION_RECHAZO_MS, 10_000);
  assert.equal(r.plazoMs, PLAZO_CONFIRMACION_RECHAZO_MS);
  r.plazoMs = 5;
  const inicio = Date.now();
  assert.equal(await r.esperar("x").resultado, false);
  assert.ok(Date.now() - inicio < 1_000);
  assert.equal(r.cantidadPendiente, 0);
  assert.equal(new ConfirmacionesPublicacionWeb().plazoMs, 10_000);
});

test("E16 confirmaciones: confirmar un id desconocido o ya resuelto no lanza", async () => {
  const r = new ConfirmacionesPublicacionWeb();
  r.confirmar("nunca", true);
  const e = r.esperar("e", 100);
  r.confirmar("e", true);
  r.confirmar("e", false);
  assert.equal(await e.resultado, true);
});
