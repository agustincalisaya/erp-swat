import assert from "node:assert/strict";
import test from "node:test";
import {
  BajaCuentaWebSchema,
  BuscarCuentaPorDniSchema,
  RedefinirPasswordSchema,
  RegistroCuentaWebSchema,
  ValidarVinculacionSchema,
} from "./cuenta-cliente-web.schema.ts";

test("RegistroCuentaWebSchema normaliza identidad sin transformar la contraseña", () => {
  const parsed = RegistroCuentaWebSchema.parse({
    nombre: "  Ana Pérez  ", dni: "30123456", telefono: " 3874000000 ",
    email: " ANA@EXAMPLE.COM ", password: "  secreta  ", acepta_tratamiento: true,
  });
  assert.equal(parsed.nombre, "Ana Pérez");
  assert.equal(parsed.telefono, "3874000000");
  assert.equal(parsed.email, "ana@example.com");
  assert.equal(parsed.password, "  secreta  ");
  assert.equal(parsed.acepta_comunicaciones, false);
});

test("schemas E8 aplican contratos de recuperación, baja, vinculación y DNI", () => {
  assert.equal(RedefinirPasswordSchema.safeParse({ email: "a@b.com", codigo: "ABCDEFGH", password: "12345678", confirmacion: "87654321" }).success, false);
  assert.equal(BajaCuentaWebSchema.safeParse({ motivo: " ", confirmar: true }).success, false);
  assert.equal(ValidarVinculacionSchema.safeParse({ email_reconocido: false }).success, false);
  assert.equal(ValidarVinculacionSchema.safeParse({ email_reconocido: true, email_titular: "otro@example.com" }).success, false);
  assert.equal(BuscarCuentaPorDniSchema.safeParse({ dni: "123" }).success, false);
});
