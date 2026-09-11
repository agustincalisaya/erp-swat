import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calcularMontoDesdeItemsAceptados } from "./cuenta-por-pagar.calculo.ts";

// HU-G8 §2.2 / criterio 4 — el monto de la CuentaPorPagar DEFINITIVA se
// recalcula como Σ(cantidad_aceptada × precio_unitario) sobre los RecepcionItem
// activos, agregados por orden_compra_item_id. Suma lo efectivamente RECIBIDO Y
// VALIDADO (cantidad_aceptada), nunca lo pedido (cantidad_solicitada) ni lo que
// llegó pero fue rechazado (la diferencia recibida − aceptada). SIEMPRE
// Prisma.Decimal — nunca `number` de JS ni `.toNumber()`.

test("calcularMontoDesdeItemsAceptados: lista vacía devuelve un Decimal igual a 0", () => {
  const total = calcularMontoDesdeItemsAceptados([]);
  assert.ok(total instanceof Prisma.Decimal);
  assert.equal(total.equals(0), true);
  assert.equal(total.toString(), "0");
});

test("calcularMontoDesdeItemsAceptados: aceptado = recibido (sin discrepancia) suma el total completo", () => {
  // Pedido y recibido y aceptado coinciden: 10×15800 + 5×42000 = 368000.
  const total = calcularMontoDesdeItemsAceptados([
    { cantidad_aceptada: 10, precio_unitario: new Prisma.Decimal("15800.00") },
    { cantidad_aceptada: 5, precio_unitario: new Prisma.Decimal("42000.00") },
  ]);
  assert.equal(total.equals(368000), true);
  assert.equal(total.toFixed(2), "368000.00");
});

test("calcularMontoDesdeItemsAceptados: aceptado < recibido (discrepancia de calidad) factura solo lo validado", () => {
  // Mismo pedido que arriba (368000) pero 3 unidades del ítem A rechazadas:
  // aceptado = 7×15800 + 5×42000 = 110600 + 210000 = 320600.
  const total = calcularMontoDesdeItemsAceptados([
    { cantidad_aceptada: 7, precio_unitario: new Prisma.Decimal("15800.00") },
    { cantidad_aceptada: 5, precio_unitario: new Prisma.Decimal("42000.00") },
  ]);
  assert.equal(total.equals(320600), true);
  assert.equal(total.toFixed(2), "320600.00");
  // No es el monto "sobre lo pedido" (368000).
  assert.equal(total.equals(368000), false);
});

test("calcularMontoDesdeItemsAceptados: un ítem sin ninguna Recepcion aporta 0, no rompe el cálculo", () => {
  // En la práctica no debería pasar (CERRAR exige RECIBIDA_COMPLETA), pero un
  // ítem sin recepción se representa con cantidad_aceptada: 0 y debe sumar 0.
  const total = calcularMontoDesdeItemsAceptados([
    { cantidad_aceptada: 0, precio_unitario: new Prisma.Decimal("15800.00") },
    { cantidad_aceptada: 5, precio_unitario: new Prisma.Decimal("42000.00") },
  ]);
  assert.equal(total.equals(210000), true);
  assert.equal(total.toFixed(2), "210000.00");
});

test("calcularMontoDesdeItemsAceptados: suma exacta en Decimal donde .toNumber() derivaría (0.1 × 3)", () => {
  const total = calcularMontoDesdeItemsAceptados([
    { cantidad_aceptada: 1, precio_unitario: new Prisma.Decimal("0.10") },
    { cantidad_aceptada: 1, precio_unitario: new Prisma.Decimal("0.10") },
    { cantidad_aceptada: 1, precio_unitario: new Prisma.Decimal("0.10") },
  ]);
  assert.equal(total.equals("0.3"), true);
  assert.equal(total.toString(), "0.3");
  assert.notEqual(total.toString(), (0.1 + 0.1 + 0.1).toString());
});

test("calcularMontoDesdeItemsAceptados: preserva la escala 2 del contrato (Decimal(12,2))", () => {
  const total = calcularMontoDesdeItemsAceptados([
    { cantidad_aceptada: 3, precio_unitario: new Prisma.Decimal("10.00") },
  ]);
  assert.equal(total.equals(30), true);
  assert.equal(total.toFixed(2), "30.00");
});
