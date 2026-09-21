import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de los schemas de entrada del Módulo C:
 * `AgregarDireccionClienteSchema` (HU-C3, spec_modulo_C.md §2.3) y el
 * normalizado de `email` de `CrearClienteSchema` (HU-C1, spec §2.1). Corren
 * bajo el script `test` principal (`node --experimental-strip-types --test`),
 * por eso el import es relativo con extensión explícita: ese runner no
 * resuelve el alias `@/`.
 *
 * El módulo bajo prueba solo importa `zod` — no toca Prisma ni
 * `server-only`, así que se puede cargar tal cual.
 */
import { AgregarDireccionClienteSchema, CrearClienteSchema } from "./clientes.schema.ts";

const VALIDO = {
  rotulo: "Casa",
  tipo: "FACTURACION" as const,
  direccion_completa: "Av. Siempreviva 742",
};

test("AgregarDireccionClienteSchema: un payload válido parsea sin cambios", () => {
  const parsed = AgregarDireccionClienteSchema.safeParse(VALIDO);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success ? parsed.data : null, VALIDO);
});

test("AgregarDireccionClienteSchema: acepta los dos valores del enum TipoDireccionCliente", () => {
  for (const tipo of ["FACTURACION", "ENVIO"] as const) {
    assert.equal(
      AgregarDireccionClienteSchema.safeParse({ ...VALIDO, tipo }).success,
      true,
      `${tipo} debería ser válido`,
    );
  }
});

test("AgregarDireccionClienteSchema: `rotulo` vacío es inválido", () => {
  const parsed = AgregarDireccionClienteSchema.safeParse({ ...VALIDO, rotulo: "" });
  assert.equal(parsed.success, false);
  assert.match(
    parsed.success ? "" : (parsed.error.issues[0]?.message ?? ""),
    /rótulo/i,
  );
});

test("AgregarDireccionClienteSchema: `tipo` fuera del enum es inválido", () => {
  assert.equal(
    AgregarDireccionClienteSchema.safeParse({ ...VALIDO, tipo: "SUCURSAL" }).success,
    false,
  );
  assert.equal(
    AgregarDireccionClienteSchema.safeParse({ ...VALIDO, tipo: "facturacion" }).success,
    false,
  );
  assert.equal(
    AgregarDireccionClienteSchema.safeParse({ ...VALIDO, tipo: undefined }).success,
    false,
  );
});

test("AgregarDireccionClienteSchema: `direccion_completa` con menos de 5 caracteres es inválida", () => {
  assert.equal(
    AgregarDireccionClienteSchema.safeParse({ ...VALIDO, direccion_completa: "Casa" }).success,
    false,
  );
  assert.equal(
    AgregarDireccionClienteSchema.safeParse({ ...VALIDO, direccion_completa: "Cll" }).success,
    false,
  );
  // Exactamente 5 caracteres pasa (el mínimo es inclusivo).
  assert.equal(
    AgregarDireccionClienteSchema.safeParse({ ...VALIDO, direccion_completa: "Casa1" }).success,
    true,
  );
});

test("AgregarDireccionClienteSchema: `direccion_completa` ausente es inválida", () => {
  assert.equal(
    AgregarDireccionClienteSchema.safeParse({ rotulo: "Casa", tipo: "FACTURACION" }).success,
    false,
  );
});

test("AgregarDireccionClienteSchema: un `cliente_id` espurio en el body PASA y se descarta del resultado", () => {
  // Spec §2.3 — sin `.strict()`: el cliente NUNCA se lee del body, solo del
  // path param `[id]`. Zod descarta la clave desconocida en vez de rechazar.
  const parsed = AgregarDireccionClienteSchema.safeParse({
    ...VALIDO,
    cliente_id: "99999999-9999-4999-8999-999999999999",
  });
  assert.equal(parsed.success, true, "un cliente_id espurio NO debe invalidar el payload");
  assert.deepEqual(parsed.success ? parsed.data : null, VALIDO);
  assert.equal("cliente_id" in (parsed.success ? parsed.data : {}), false);
});

// ── HU-C1: normalizado del email en el alta de cliente ───────────────────────
const CLIENTE_OK = { dni: "30123456", nombre: "Juan Pérez" };

test("CrearClienteSchema: email vacío es válido y se trata como ausente", () => {
  const conVacio = CrearClienteSchema.safeParse({ ...CLIENTE_OK, email: "" });
  assert.equal(conVacio.success, true);
  assert.equal(conVacio.success ? conVacio.data.email : "x", undefined);

  assert.equal(CrearClienteSchema.safeParse({ ...CLIENTE_OK }).success, true);
  assert.equal(CrearClienteSchema.safeParse({ ...CLIENTE_OK, email: "juan@mail.com" }).success, true);
  assert.equal(CrearClienteSchema.safeParse({ ...CLIENTE_OK, email: "no-es-email" }).success, false);
});

test("CrearClienteSchema: distingue decisiones expresas de campos ausentes", () => {
  const anterior = CrearClienteSchema.safeParse(CLIENTE_OK);
  assert.equal(anterior.success, true, "el parseo estructural permite recuperar un DNI existente");
  assert.equal(anterior.success ? anterior.data.acepta_tratamiento_datos : null, undefined);
  assert.equal(anterior.success ? anterior.data.decision_comercial : null, undefined);

  for (const decision_comercial of ["ACEPTA", "RECHAZA"] as const) {
    const parsed = CrearClienteSchema.safeParse({
      ...CLIENTE_OK,
      acepta_tratamiento_datos: true,
      decision_comercial,
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success ? parsed.data.decision_comercial : null, decision_comercial);
  }

  assert.equal(CrearClienteSchema.safeParse({ ...CLIENTE_OK, acepta_tratamiento_datos: false }).success, true);
  assert.equal(CrearClienteSchema.safeParse({ ...CLIENTE_OK, decision_comercial: null }).success, false);
  assert.equal(CrearClienteSchema.safeParse({ ...CLIENTE_OK, decision_comercial: "NO_INDICADO" }).success, false);
  assert.equal(CrearClienteSchema.safeParse({ ...CLIENTE_OK, acepta_tratamiento_datos: "true" }).success, false);
});
