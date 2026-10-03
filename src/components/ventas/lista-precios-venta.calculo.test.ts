import assert from "node:assert/strict";
import test from "node:test";

import {
  construirPayloadVersion,
  filtrarFilas,
  parsearMargen,
  parsearPrecio,
  requiereMotivo,
  vigenteDesdeArgentina,
  type EdicionFila,
  type FilaListaPrecioVenta,
} from "./lista-precios-venta.calculo.ts";

const CT1 = "407e729d-47c3-404d-a89a-0a9c1f85a3db";
const GORRA = "bc8d1631-2378-4c63-826f-16e2cc814eea";
const CAMPOL = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";
const HOY = "2026-10-03";

const FILAS: FilaListaPrecioVenta[] = [
  { variante_sku_id: CT1, sku: "CT-M-VER", descripcion: "Camisa Táctica · M/Verde", precio_vigente: 21100, costo_reposicion: 15600, precio_sugerido: 21060 },
  { variante_sku_id: GORRA, sku: "GOR-U-NEG", descripcion: "Gorra Táctica · U/Negro", precio_vigente: 9500, costo_reposicion: null, precio_sugerido: null },
  { variante_sku_id: CAMPOL, sku: "CAMPOL-M-AZU", descripcion: "Camisa de Policía · M/Azul", precio_vigente: null, costo_reposicion: null, precio_sugerido: null },
];

function ediciones(entradas: Record<string, Partial<EdicionFila>>): Map<string, EdicionFila> {
  return new Map(Object.entries(entradas).map(([id, e]) => [id, { precio: e.precio ?? "", motivo: e.motivo ?? "" }]));
}

// ── parsearMargen / parsearPrecio ────────────────────────────────────────────

test("parsearMargen: número no negativo o null (mismo criterio que el servicio)", () => {
  assert.equal(parsearMargen("0.35"), 0.35);
  assert.equal(parsearMargen("0"), 0);
  assert.equal(parsearMargen(""), null);
  assert.equal(parsearMargen("  "), null);
  assert.equal(parsearMargen("abc"), null);
  assert.equal(parsearMargen("-0.1"), null);
});

test("parsearPrecio: positivo con hasta 2 decimales, acepta coma decimal", () => {
  assert.equal(parsearPrecio("21060"), 21060);
  assert.equal(parsearPrecio("21532,5"), 21532.5);
  assert.equal(parsearPrecio(" 99.99 "), 99.99);
  assert.equal(parsearPrecio("0"), null);
  assert.equal(parsearPrecio("-5"), null);
  assert.equal(parsearPrecio("1.234"), null);
  assert.equal(parsearPrecio("abc"), null);
  assert.equal(parsearPrecio(""), null);
});

// ── requiereMotivo (input de motivo condicional) ─────────────────────────────

test("requiereMotivo: aparece solo si el precio es válido y menor al costo", () => {
  assert.equal(requiereMotivo("15599", 15600), true);
  assert.equal(requiereMotivo("15600", 15600), false, "igual al costo no es bajo costo");
  assert.equal(requiereMotivo("21060", 15600), false);
  assert.equal(requiereMotivo("1", null), false, "sin costo no aplica");
  assert.equal(requiereMotivo("", 15600), false, "input vacío no muestra motivo");
  assert.equal(requiereMotivo("abc", 15600), false, "precio inválido no muestra motivo");
});

// ── vigenteDesdeArgentina ────────────────────────────────────────────────────

test("vigenteDesdeArgentina: medianoche de Argentina con offset explícito, no UTC", () => {
  const iso = vigenteDesdeArgentina("2026-10-05");
  assert.equal(iso, "2026-10-05T00:00:00-03:00");
  assert.equal(new Date(iso).toISOString(), "2026-10-05T03:00:00.000Z");
});

// ── filtrarFilas ─────────────────────────────────────────────────────────────

test("filtrarFilas: por SKU o descripción, sin distinguir mayúsculas", () => {
  assert.equal(filtrarFilas(FILAS, "").length, 3);
  assert.deepEqual(filtrarFilas(FILAS, "gor").map((f) => f.variante_sku_id), [GORRA]);
  assert.deepEqual(filtrarFilas(FILAS, "CAMISA").map((f) => f.variante_sku_id), [CT1, CAMPOL]);
  assert.equal(filtrarFilas(FILAS, "inexistente").length, 0);
});

// ── construirPayloadVersion (habilitado del botón "Publicar versión") ────────

test("construirPayloadVersion: sin filas cargadas → SIN_ITEMS (botón deshabilitado)", () => {
  const r = construirPayloadVersion(FILAS, new Map(), HOY, HOY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error_general, "SIN_ITEMS");
});

test("construirPayloadVersion: solo viajan las filas con precio cargado", () => {
  const r = construirPayloadVersion(FILAS, ediciones({ [CT1]: { precio: "22000" }, [GORRA]: { precio: "  " } }), HOY, HOY);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.payload.items, [{ variante_sku_id: CT1, precio_venta: 22000 }]);
    assert.equal(r.payload.vigente_desde, "2026-10-03T00:00:00-03:00");
    assert.equal(r.items_bajo_costo, 0);
  }
});

test("construirPayloadVersion: bajo costo sin motivo → MOTIVO_REQUERIDO en la fila", () => {
  const r = construirPayloadVersion(FILAS, ediciones({ [CT1]: { precio: "15000", motivo: "   " } }), HOY, HOY);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.errores_fila.get(CT1), "MOTIVO_REQUERIDO");
    assert.equal(r.error_general, null);
  }
});

test("construirPayloadVersion: bajo costo con motivo → se envía el motivo recortado", () => {
  const r = construirPayloadVersion(FILAS, ediciones({ [CT1]: { precio: "15000", motivo: " liquidación " } }), HOY, HOY);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.payload.items, [{ variante_sku_id: CT1, precio_venta: 15000, motivo_bajo_costo: "liquidación" }]);
    assert.equal(r.items_bajo_costo, 1);
  }
});

test("construirPayloadVersion: motivo tipeado sin bajo costo no se envía", () => {
  const r = construirPayloadVersion(FILAS, ediciones({ [CT1]: { precio: "30000", motivo: "quedó de antes" } }), HOY, HOY);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.payload.items, [{ variante_sku_id: CT1, precio_venta: 30000 }]);
});

test("construirPayloadVersion: sin costo (Gorra) cualquier precio positivo es válido sin motivo", () => {
  const r = construirPayloadVersion(FILAS, ediciones({ [GORRA]: { precio: "1" } }), HOY, HOY);
  assert.equal(r.ok, true);
});

test("construirPayloadVersion: precio inválido en una fila bloquea la publicación", () => {
  const r = construirPayloadVersion(FILAS, ediciones({ [CT1]: { precio: "22000" }, [CAMPOL]: { precio: "0" } }), HOY, HOY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errores_fila.get(CAMPOL), "PRECIO_INVALIDO");
});

test("construirPayloadVersion: fecha anterior a hoy o vacía → FECHA_INVALIDA", () => {
  const e = ediciones({ [CT1]: { precio: "22000" } });
  for (const fecha of ["2026-10-02", "", "03/10/2026"]) {
    const r = construirPayloadVersion(FILAS, e, fecha, HOY);
    assert.equal(r.ok, false, fecha);
    if (!r.ok) assert.equal(r.error_general, "FECHA_INVALIDA");
  }
  assert.equal(construirPayloadVersion(FILAS, e, "2026-10-10", HOY).ok, true, "fecha futura es válida");
});
