import assert from "node:assert/strict";
import test from "node:test";
import { calcularClaveIdempotencia, renderizarPlantilla } from "./notificacion.reglas.ts";

test("clave de idempotencia: determinística por (evento, registro, destinatario)", () => {
  const a = calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-1", "cuenta-1");
  assert.equal(a, calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-1", "cuenta-1"));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-2", "cuenta-1"));
  assert.notEqual(a, calcularClaveIdempotencia("ecommerce:carrito_articulo_no_disponible", "item-1", "cuenta-2"));
});

test("clave de idempotencia: misma fórmula que los fixtures del seed (sha256 de tipo:registro:destinatario)", async () => {
  const { createHash } = await import("node:crypto");
  assert.equal(
    calcularClaveIdempotencia("t", "r", "d"),
    createHash("sha256").update("t:r:d").digest("hex"),
  );
});

test("renderizado: reemplaza placeholders y deja vacío lo que falta, sin lanzar (spec F §3.2)", () => {
  assert.equal(
    renderizarPlantilla("El artículo {{sku}} ({{ motivo }}) — {{inexistente}}.", { sku: "CAMTAC-1", motivo: "SKU_INACTIVO" }),
    "El artículo CAMTAC-1 (SKU_INACTIVO) — .",
  );
  assert.equal(renderizarPlantilla("{{a}}{{a}}", { a: 1 }), "11");
  assert.equal(renderizarPlantilla("sin placeholders", {}), "sin placeholders");
});
