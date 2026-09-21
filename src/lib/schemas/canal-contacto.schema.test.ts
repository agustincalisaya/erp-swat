import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de `ActualizarCanalContactoSchema` (HU-C9,
 * spec_modulo_C.md §2.3). Corren bajo el script `test` principal
 * (`node --experimental-strip-types --test`), por eso el import es relativo
 * con extensión explícita: ese runner no resuelve el alias `@/`.
 *
 * El módulo bajo prueba solo importa `zod` — no toca Prisma ni
 * `server-only`, así que se puede cargar tal cual.
 */
import { ActualizarCanalContactoSchema } from "./clientes.schema.ts";

test("ActualizarCanalContactoSchema: acepta los tres valores del enum CanalContacto", () => {
  for (const canal_preferido of ["WHATSAPP", "EMAIL", "AMBOS"] as const) {
    const parsed = ActualizarCanalContactoSchema.safeParse({ canal_preferido });
    assert.equal(parsed.success, true, `${canal_preferido} debería ser válido`);
    assert.deepEqual(parsed.success ? parsed.data : null, { canal_preferido });
  }
});

test("ActualizarCanalContactoSchema: un valor fuera del enum es inválido", () => {
  assert.equal(
    ActualizarCanalContactoSchema.safeParse({ canal_preferido: "TELEGRAM" }).success,
    false,
  );
  assert.equal(
    ActualizarCanalContactoSchema.safeParse({ canal_preferido: "whatsapp" }).success,
    false,
  );
  assert.equal(
    ActualizarCanalContactoSchema.safeParse({ canal_preferido: undefined }).success,
    false,
  );
});

test("ActualizarCanalContactoSchema: `null` no es un valor válido (no hay operación de limpieza)", () => {
  assert.equal(
    ActualizarCanalContactoSchema.safeParse({ canal_preferido: null }).success,
    false,
  );
});

test("ActualizarCanalContactoSchema: un `cliente_id` espurio en el body PASA y se descarta del resultado", () => {
  // Spec §2.3 — sin `.strict()`: el cliente NUNCA se lee del body, solo del
  // path param `[id]`. Zod descarta la clave desconocida en vez de rechazar.
  const parsed = ActualizarCanalContactoSchema.safeParse({
    canal_preferido: "WHATSAPP",
    cliente_id: "99999999-9999-4999-8999-999999999999",
  });
  assert.equal(parsed.success, true, "un cliente_id espurio NO debe invalidar el payload");
  assert.deepEqual(parsed.success ? parsed.data : null, { canal_preferido: "WHATSAPP" });
  assert.equal("cliente_id" in (parsed.success ? parsed.data : {}), false);
});
