import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularTotalItem,
  calcularTotalVenta,
  itemSuperaMargenDescuento,
  sumarMediosPago,
} from "./venta-mostrador.calculo.ts";

// ── calcularTotalItem ────────────────────────────────────────────────────────

test("calcularTotalItem: sin descuento, es precio_unitario * cantidad", () => {
  assert.equal(calcularTotalItem({ precio_unitario: 45000, cantidad: 1 }), 45000);
  assert.equal(calcularTotalItem({ precio_unitario: 1500, cantidad: 3 }), 4500);
});

test("calcularTotalItem: aplica el descuento_porcentual sobre el bruto", () => {
  // 1000 * 2 = 2000 bruto; 10% de descuento => 1800.
  assert.equal(calcularTotalItem({ precio_unitario: 1000, cantidad: 2, descuento_porcentual: 10 }), 1800);
});

test("calcularTotalItem: descuento_porcentual null/undefined equivale a 0", () => {
  assert.equal(calcularTotalItem({ precio_unitario: 500, cantidad: 1, descuento_porcentual: null }), 500);
  assert.equal(calcularTotalItem({ precio_unitario: 500, cantidad: 1 }), 500);
});

test("calcularTotalItem: redondea a 2 decimales sin artefactos de punto flotante", () => {
  assert.equal(calcularTotalItem({ precio_unitario: 0.1, cantidad: 3 }), 0.3);
});

test("calcularTotalItem: descuento 100% da total 0", () => {
  assert.equal(calcularTotalItem({ precio_unitario: 1000, cantidad: 1, descuento_porcentual: 100 }), 0);
});

// ── calcularTotalVenta ───────────────────────────────────────────────────────

test("calcularTotalVenta: suma calcularTotalItem() de todos los ítems", () => {
  const total = calcularTotalVenta([
    { precio_unitario: 45000, cantidad: 1 },
    { precio_unitario: 20000, cantidad: 1, descuento_porcentual: 25 },
  ]);
  // 45000 + (20000 * 0.75 = 15000) = 60000.
  assert.equal(total, 60000);
});

test("calcularTotalVenta: lista vacía da 0", () => {
  assert.equal(calcularTotalVenta([]), 0);
});

// ── itemSuperaMargenDescuento (MARGEN_DESCUENTO_CAJERO_POS = 5) ─────────────

test("itemSuperaMargenDescuento: dentro del margen (incluido el límite exacto) no supera", () => {
  assert.equal(itemSuperaMargenDescuento(5, 5), false);
  assert.equal(itemSuperaMargenDescuento(0, 5), false);
  assert.equal(itemSuperaMargenDescuento(null, 5), false);
  assert.equal(itemSuperaMargenDescuento(undefined, 5), false);
});

test("itemSuperaMargenDescuento: por encima del margen supera", () => {
  assert.equal(itemSuperaMargenDescuento(5.01, 5), true);
  assert.equal(itemSuperaMargenDescuento(50, 5), true);
});

// ── sumarMediosPago ──────────────────────────────────────────────────────────

test("sumarMediosPago: suma los importes de cada medio de pago", () => {
  assert.equal(
    sumarMediosPago([{ importe: 20000 }, { importe: 25000 }]),
    45000,
  );
});

test("sumarMediosPago: redondea a 2 decimales", () => {
  assert.equal(sumarMediosPago([{ importe: 0.1 }, { importe: 0.2 }]), 0.3);
});
