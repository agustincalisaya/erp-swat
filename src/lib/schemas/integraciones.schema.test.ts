import assert from "node:assert/strict";
import test from "node:test";
import {
  BajaConectorSchema,
  BitacoraQuerySchema,
  CrearConectorMercadoPagoSchema,
} from "./integraciones.schema.ts";

/**
 * HU-F1 (R2) — schemas Zod de la gestión del Conector. Tests de comportamiento
 * real (Zod es importable bajo el runner unitario, sin `server-only` ni alias).
 */

// ──────────────────────────────────────────────────────────────────────────────
// CrearConectorMercadoPagoSchema (spec F §2.1.1, exacto)
// ──────────────────────────────────────────────────────────────────────────────

test("CrearConectorMercadoPagoSchema acepta un alta completa en SANDBOX", () => {
  const resultado = CrearConectorMercadoPagoSchema.safeParse({
    nombre: "Conector Sandbox",
    entorno: "SANDBOX",
    access_token: "APP_USR-1234",
    public_key: "APP_USR-pub",
    webhook_secret: "secreto",
  });
  assert.equal(resultado.success, true);
});

test("CrearConectorMercadoPagoSchema exige nombre de al menos 2 caracteres", () => {
  const base = {
    entorno: "SANDBOX",
    access_token: "t",
    public_key: "p",
    webhook_secret: "w",
  };
  assert.equal(CrearConectorMercadoPagoSchema.safeParse({ nombre: "A", ...base }).success, false);
  assert.equal(CrearConectorMercadoPagoSchema.safeParse({ nombre: "AB", ...base }).success, true);
});

test("CrearConectorMercadoPagoSchema rechaza un entorno distinto de SANDBOX|PRODUCCION", () => {
  const resultado = CrearConectorMercadoPagoSchema.safeParse({
    nombre: "Conector",
    entorno: "TEST",
    access_token: "t",
    public_key: "p",
    webhook_secret: "w",
  });
  assert.equal(resultado.success, false);
});

test("CrearConectorMercadoPagoSchema exige las 3 credenciales no vacías", () => {
  const base = { nombre: "Conector", entorno: "PRODUCCION" };
  assert.equal(CrearConectorMercadoPagoSchema.safeParse({ ...base, access_token: "", public_key: "p", webhook_secret: "w" }).success, false);
  assert.equal(CrearConectorMercadoPagoSchema.safeParse({ ...base, access_token: "t", public_key: "", webhook_secret: "w" }).success, false);
  assert.equal(CrearConectorMercadoPagoSchema.safeParse({ ...base, access_token: "t", public_key: "p", webhook_secret: "" }).success, false);
});

// ──────────────────────────────────────────────────────────────────────────────
// BajaConectorSchema (R2.2)
// ──────────────────────────────────────────────────────────────────────────────

test("BajaConectorSchema exige deletion_reason con mensaje del spec", () => {
  const vacio = BajaConectorSchema.safeParse({ deletion_reason: "" });
  assert.equal(vacio.success, false);
  if (!vacio.success) {
    assert.equal(vacio.error.issues[0]?.message, "El motivo es obligatorio");
  }
  assert.equal(BajaConectorSchema.safeParse({ deletion_reason: "Rotación" }).success, true);
});

// ──────────────────────────────────────────────────────────────────────────────
// BitacoraQuerySchema (R2.3) — page_size máx 50
// ──────────────────────────────────────────────────────────────────────────────

test("BitacoraQuerySchema aplica defaults page=1 y page_size=20 con coerción", () => {
  const resultado = BitacoraQuerySchema.parse({});
  assert.equal(resultado.page, 1);
  assert.equal(resultado.page_size, 20);
  assert.equal(BitacoraQuerySchema.parse({ page: "3", page_size: "10" }).page_size, 10);
});

test("BitacoraQuerySchema acepta page_size=50 y rechaza 51 (bound del spec)", () => {
  assert.equal(BitacoraQuerySchema.safeParse({ page_size: 50 }).success, true);
  assert.equal(BitacoraQuerySchema.safeParse({ page_size: 51 }).success, false);
});

test("BitacoraQuerySchema rechaza page/page_size no positivos o no numéricos", () => {
  assert.equal(BitacoraQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(BitacoraQuerySchema.safeParse({ page_size: 0 }).success, false);
  assert.equal(BitacoraQuerySchema.safeParse({ page: "abc" }).success, false);
});
