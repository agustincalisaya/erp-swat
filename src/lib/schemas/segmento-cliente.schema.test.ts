import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de `ActualizarSegmentoClienteSchema` (HU-C8,
 * spec_modulo_C.md §2.8). Corren bajo el script `test` principal
 * (`node --experimental-strip-types --test`), por eso el import es relativo
 * con extensión explícita: ese runner no resuelve el alias `@/`.
 *
 * El módulo bajo prueba solo importa `zod` — no toca Prisma ni
 * `server-only`, así que se puede cargar tal cual.
 */
import { ActualizarSegmentoClienteSchema } from "./clientes.schema.ts";

test("ActualizarSegmentoClienteSchema: acepta los tres valores del enum SegmentoComercial", () => {
  for (const segmento of ["MINORISTA", "MAYORISTA", "CLIENTE_FRECUENTE"] as const) {
    const parsed = ActualizarSegmentoClienteSchema.safeParse({ segmento });
    assert.equal(parsed.success, true, `${segmento} debería ser válido`);
    assert.deepEqual(parsed.success ? parsed.data : null, { segmento });
  }
});

test("ActualizarSegmentoClienteSchema: un valor fuera del enum es inválido", () => {
  assert.equal(
    ActualizarSegmentoClienteSchema.safeParse({ segmento: "VIP" }).success,
    false,
  );
  assert.equal(
    ActualizarSegmentoClienteSchema.safeParse({ segmento: "minorista" }).success,
    false,
  );
});

test("ActualizarSegmentoClienteSchema: `null`, `undefined` y campo ausente no son válidos", () => {
  assert.equal(
    ActualizarSegmentoClienteSchema.safeParse({ segmento: null }).success,
    false,
  );
  assert.equal(
    ActualizarSegmentoClienteSchema.safeParse({ segmento: undefined }).success,
    false,
  );
  assert.equal(ActualizarSegmentoClienteSchema.safeParse({}).success, false);
});

test("ActualizarSegmentoClienteSchema: un `cliente_id` espurio en el body PASA y se descarta del resultado", () => {
  // Spec §2.8 — sin `.strict()`: el cliente NUNCA se lee del body, solo del
  // path param `[id]`. Zod descarta la clave desconocida en vez de rechazar.
  const parsed = ActualizarSegmentoClienteSchema.safeParse({
    segmento: "MAYORISTA",
    cliente_id: "99999999-9999-4999-8999-999999999999",
  });
  assert.equal(parsed.success, true, "un cliente_id espurio NO debe invalidar el payload");
  assert.deepEqual(parsed.success ? parsed.data : null, { segmento: "MAYORISTA" });
  assert.equal("cliente_id" in (parsed.success ? parsed.data : {}), false);
});
