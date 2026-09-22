import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de `BajaClienteSchema` (HU-C6, spec_modulo_C.md §2.6).
 * Corren bajo el script `test` principal (`node --experimental-strip-types
 * --test`), por eso el import es relativo con extensión explícita.
 */
import { BajaClienteSchema } from "./clientes.schema.ts";

test("BajaClienteSchema: el motivo es obligatorio (ausente, vacío o solo espacios rechazan)", () => {
  assert.equal(BajaClienteSchema.safeParse({}).success, false);
  assert.equal(BajaClienteSchema.safeParse({ deletion_reason: "" }).success, false);
  assert.equal(BajaClienteSchema.safeParse({ deletion_reason: "   " }).success, false);
  assert.equal(BajaClienteSchema.safeParse(null).success, false);
});

test("BajaClienteSchema: un motivo no vacío es válido", () => {
  const parsed = BajaClienteSchema.safeParse({ deletion_reason: "Cliente duplicado por error de carga" });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success ? parsed.data : null, {
    deletion_reason: "Cliente duplicado por error de carga",
  });
});

test("BajaClienteSchema: descarta en silencio un cliente_id espurio del body", () => {
  const parsed = BajaClienteSchema.safeParse({ deletion_reason: "Motivo", cliente_id: "otro" });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success ? parsed.data : null, { deletion_reason: "Motivo" });
});
