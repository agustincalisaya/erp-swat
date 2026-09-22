import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de `PublicarListaPreciosSchema` (HU-H2). Corren bajo
 * el script `test` principal (`node --experimental-strip-types --test`), por
 * eso el import es relativo con extensión explícita.
 */
import {
  esErrorItemsDuplicados,
  PublicarListaPreciosSchema,
} from "./lista-precios.schema.ts";

const SKU_A = "11111111-1111-4111-8111-111111111111";
const SKU_B = "22222222-2222-4222-8222-222222222222";
const HOY = new Date().toISOString();

test("PublicarListaPreciosSchema: la misma variante repetida (precios distintos) → ITEMS_DUPLICADOS", () => {
  const parsed = PublicarListaPreciosSchema.safeParse({
    fecha_inicio_vigencia: HOY,
    items: [
      { variante_sku_id: SKU_A, precio_unitario: 1000 },
      { variante_sku_id: SKU_A, precio_unitario: 1200 },
    ],
  });
  assert.equal(parsed.success, false);
  assert.equal(parsed.success ? null : esErrorItemsDuplicados(parsed.error), true);
});

test("PublicarListaPreciosSchema: variantes distintas son válidas", () => {
  const parsed = PublicarListaPreciosSchema.safeParse({
    fecha_inicio_vigencia: HOY,
    items: [
      { variante_sku_id: SKU_A, precio_unitario: 1000 },
      { variante_sku_id: SKU_B, precio_unitario: 1200 },
    ],
  });
  assert.equal(parsed.success, true);
});

test("PublicarListaPreciosSchema: otro error de validación no se confunde con ITEMS_DUPLICADOS", () => {
  const parsed = PublicarListaPreciosSchema.safeParse({
    fecha_inicio_vigencia: HOY,
    items: [{ variante_sku_id: SKU_A, precio_unitario: -5 }],
  });
  assert.equal(parsed.success, false);
  assert.equal(parsed.success ? null : esErrorItemsDuplicados(parsed.error), false);
});
