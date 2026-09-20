import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de `AgregarDireccionClienteSchema` (HU-C3,
 * spec_modulo_C.md §2.3). Corren bajo el script `test` principal
 * (`node --experimental-strip-types --test`), por eso el import es relativo
 * con extensión explícita: ese runner no resuelve el alias `@/`.
 *
 * El módulo bajo prueba solo importa `zod` — no toca Prisma ni
 * `server-only`, así que se puede cargar tal cual.
 */
import { AgregarDireccionClienteSchema } from "./clientes.schema.ts";

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

// ── HU-C1 + HU-C3: alta de cliente con dirección opcional ────────────────────
import { AltaClienteConDireccionSchema, CrearClienteSchema, armarDireccionAlta } from "./clientes.schema.ts";

const CLIENTE_OK = { dni: "30123456", nombre: "Juan Pérez" };

test("AltaClienteConDireccionSchema: sin dirección (campos vacíos) es válido", () => {
  assert.equal(AltaClienteConDireccionSchema.safeParse(CLIENTE_OK).success, true);
  assert.equal(
    AltaClienteConDireccionSchema.safeParse({ ...CLIENTE_OK, rotulo: "", direccion_completa: "  " }).success,
    true,
  );
});

test("AltaClienteConDireccionSchema: dirección completa es válida", () => {
  const r = AltaClienteConDireccionSchema.safeParse({
    ...CLIENTE_OK,
    rotulo: "Casa",
    direccion_completa: "Av. Siempreviva 742",
  });
  assert.equal(r.success, true);
});

test("AltaClienteConDireccionSchema: dirección parcial falla en el campo faltante", () => {
  const soloRotulo = AltaClienteConDireccionSchema.safeParse({ ...CLIENTE_OK, rotulo: "Casa" });
  assert.equal(soloRotulo.success, false);
  assert.deepEqual(soloRotulo.success ? [] : soloRotulo.error.issues.map((i) => i.path[0]), ["direccion_completa"]);

  const soloDireccion = AltaClienteConDireccionSchema.safeParse({
    ...CLIENTE_OK,
    direccion_completa: "Av. Siempreviva 742",
  });
  assert.equal(soloDireccion.success, false);
  assert.deepEqual(soloDireccion.success ? [] : soloDireccion.error.issues.map((i) => i.path[0]), ["rotulo"]);
});

test("armarDireccionAlta: alta nueva con dirección completa arma el payload con tipo FACTURACION", () => {
  assert.deepEqual(armarDireccionAlta({ rotulo: " Casa ", direccion_completa: " Av. Siempreviva 742 " }, true), {
    rotulo: "Casa",
    tipo: "FACTURACION",
    direccion_completa: "Av. Siempreviva 742",
  });
});

test("armarDireccionAlta: es_nuevo=false NO envía dirección aunque esté completa", () => {
  assert.equal(armarDireccionAlta({ rotulo: "Casa", direccion_completa: "Av. Siempreviva 742" }, false), null);
});

test("armarDireccionAlta: sin datos de dirección no envía nada", () => {
  assert.equal(armarDireccionAlta({ rotulo: "", direccion_completa: "" }, true), null);
  assert.equal(armarDireccionAlta({}, true), null);
});

test("CrearClienteSchema / AltaClienteConDireccionSchema: email vacío es válido y se trata como ausente", () => {
  for (const schema of [CrearClienteSchema, AltaClienteConDireccionSchema]) {
    const conVacio = schema.safeParse({ ...CLIENTE_OK, email: "" });
    assert.equal(conVacio.success, true);
    assert.equal(conVacio.success ? conVacio.data.email : "x", undefined);

    assert.equal(schema.safeParse({ ...CLIENTE_OK }).success, true);
    assert.equal(schema.safeParse({ ...CLIENTE_OK, email: "juan@mail.com" }).success, true);
    assert.equal(schema.safeParse({ ...CLIENTE_OK, email: "no-es-email" }).success, false);
  }
});
