import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calcularMontoDesdeItems } from "./cuenta-por-pagar.calculo.ts";

// HU-G8 §2.1 / §2.2 — el monto de una CuentaPorPagar se recalcula como
// Σ(cantidad_solicitada × precio_unitario) sobre los OrdenCompraItem activos,
// SIEMPRE con Prisma.Decimal — nunca `number` de JS ni `.toNumber()`.

test("calcularMontoDesdeItems: lista vacía devuelve un Decimal igual a 0", () => {
  const total = calcularMontoDesdeItems([]);
  assert.ok(total instanceof Prisma.Decimal);
  assert.equal(total.equals(0), true);
  assert.equal(total.toString(), "0");
});

test("calcularMontoDesdeItems: preserva la escala 2 del contrato (Decimal(12,2))", () => {
  const total = calcularMontoDesdeItems([
    { cantidad_solicitada: 3, precio_unitario: new Prisma.Decimal("10.00") },
  ]);
  assert.equal(total.equals(30), true);
  assert.equal(total.toFixed(2), "30.00");
});

test("calcularMontoDesdeItems: suma exacta donde un reduce con .toNumber() derivaría (0.1 + 0.1 + 0.1)", () => {
  const total = calcularMontoDesdeItems([
    { cantidad_solicitada: 1, precio_unitario: new Prisma.Decimal("0.10") },
    { cantidad_solicitada: 1, precio_unitario: new Prisma.Decimal("0.10") },
    { cantidad_solicitada: 1, precio_unitario: new Prisma.Decimal("0.10") },
  ]);
  assert.equal(total.equals("0.3"), true);
  assert.equal(total.toString(), "0.3");
  // La suma ingenua en IEEE-754 sí deriva; el Decimal no.
  assert.notEqual(total.toString(), (0.1 + 0.1 + 0.1).toString());
});

test("calcularMontoDesdeItems: multiplicador Int exacto sobre varias líneas", () => {
  const total = calcularMontoDesdeItems([
    { cantidad_solicitada: 2, precio_unitario: new Prisma.Decimal("100.00") },
    { cantidad_solicitada: 1, precio_unitario: new Prisma.Decimal("50.00") },
  ]);
  assert.equal(total.equals(250), true);
  assert.equal(total.toFixed(2), "250.00");
});

test("calcularMontoDesdeItems: mantiene exactitud en una suma grande de muchas líneas", () => {
  const items = Array.from({ length: 1000 }, () => ({
    cantidad_solicitada: 7,
    precio_unitario: new Prisma.Decimal("1234567.89"),
  }));
  const total = calcularMontoDesdeItems(items);
  // 1000 × 7 × 1234567.89 = 8641975230
  assert.equal(total.equals("8641975230"), true);
});
