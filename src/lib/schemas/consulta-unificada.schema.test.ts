import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de `BuscarClientePorDniQuerySchema` (HU-C7,
 * spec_modulo_C.md §2.7). Corren bajo el script `test` principal
 * (`node --experimental-strip-types --test`), por eso el import es relativo
 * con extensión explícita: ese runner no resuelve el alias `@/`.
 *
 * El módulo bajo prueba solo importa `zod` — no toca Prisma ni
 * `server-only`, así que se puede cargar tal cual.
 *
 * El valor real que llega desde `req.nextUrl.searchParams.get("dni")` es
 * `string | null`: un parámetro ausente NO es `undefined` sino `null`, y el
 * schema debe rechazarlo. Ese caso se cubre explícitamente abajo.
 */
import { BuscarClientePorDniQuerySchema } from "./clientes.schema.ts";

test("BuscarClientePorDniQuerySchema: acepta DNIs de 7 y 8 dígitos", () => {
  for (const dni of ["1234567", "30123456"] as const) {
    const parsed = BuscarClientePorDniQuerySchema.safeParse({ dni });
    assert.equal(parsed.success, true, `${dni} debería ser un DNI válido`);
    assert.deepEqual(parsed.success ? parsed.data : null, { dni });
  }
});

test("BuscarClientePorDniQuerySchema: rechaza letras y valores alfanuméricos", () => {
  for (const dni of ["abc", "30abc456", "30.123.456", "30 123 456"] as const) {
    assert.equal(
      BuscarClientePorDniQuerySchema.safeParse({ dni }).success,
      false,
      `${dni} no debería ser un DNI válido`,
    );
  }
});

test("BuscarClientePorDniQuerySchema: rechaza longitudes fuera de 7-8 dígitos", () => {
  for (const dni of ["123456", "123456789"] as const) {
    assert.equal(
      BuscarClientePorDniQuerySchema.safeParse({ dni }).success,
      false,
      `${dni} no debería ser un DNI válido`,
    );
  }
});

test("BuscarClientePorDniQuerySchema: rechaza vacío, ausente y null", () => {
  // `null` es el valor real de un query param ausente
  // (`searchParams.get()` devuelve `null`, nunca `undefined`).
  assert.equal(BuscarClientePorDniQuerySchema.safeParse({ dni: "" }).success, false);
  assert.equal(BuscarClientePorDniQuerySchema.safeParse({}).success, false);
  assert.equal(BuscarClientePorDniQuerySchema.safeParse({ dni: null }).success, false);
});

test("BuscarClientePorDniQuerySchema: expone fieldErrors.dni para el mapeo 400 del Route Handler", () => {
  const parsed = BuscarClientePorDniQuerySchema.safeParse({ dni: "abc" });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.deepEqual(parsed.error.flatten().fieldErrors.dni, [
      "El DNI debe tener 7 u 8 dígitos",
    ]);
  }
});
