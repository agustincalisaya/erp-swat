import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TIPOS_EVENTO_DOMINIO } from "./event-types.ts";

/**
 * HU-F2 — task §8, Punto abierto 4: `TIPOS_EVENTO_DOMINIO` (registro runtime)
 * debe coincidir exactamente con las claves de `DomainEventMap` (que es solo
 * un tipo). Se comparan contra la fuente porque el mapa no existe en runtime.
 */

const fuente = readFileSync(new URL("./event-types.ts", import.meta.url), "utf8");

function clavesDelMapa(): string[] {
  const inicio = fuente.indexOf("export interface DomainEventMap {");
  assert.ok(inicio > -1, "no se encontró DomainEventMap");
  const fin = fuente.indexOf("\n}", inicio);
  const bloque = fuente.slice(inicio, fin);
  return [...bloque.matchAll(/^\s+"([a-z_]+:[a-z_]+)":/gm)].map((m) => m[1]);
}

test("TIPOS_EVENTO_DOMINIO cubre exactamente las claves de DomainEventMap", () => {
  assert.deepEqual([...TIPOS_EVENTO_DOMINIO].sort(), clavesDelMapa().sort());
});

test("TIPOS_EVENTO_DOMINIO no tiene duplicados", () => {
  assert.equal(new Set(TIPOS_EVENTO_DOMINIO).size, TIPOS_EVENTO_DOMINIO.length);
});

test("los 4 eventos de HU-F2 están registrados", () => {
  for (const evento of [
    "notificacion_plantilla:creada",
    "notificacion_plantilla:actualizada",
    "notificacion_plantilla:baja_logica",
    "notificacion_plantilla:reactivada",
  ]) {
    assert.ok((TIPOS_EVENTO_DOMINIO as readonly string[]).includes(evento), evento);
  }
});

test("los 5 eventos de HU-E12 están registrados", () => {
  for (const evento of [
    "ecommerce:pedido_admitido_cola",
    "ecommerce:pedido_tomado",
    "ecommerce:prioridad_preparacion_cambiada",
    "ecommerce:unidad_preparacion_confirmada",
    "ecommerce:pedido_listo_para_retiro",
  ]) {
    assert.ok((TIPOS_EVENTO_DOMINIO as readonly string[]).includes(evento), evento);
  }
});
