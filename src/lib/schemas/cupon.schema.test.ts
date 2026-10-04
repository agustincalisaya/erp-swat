import assert from "node:assert/strict";
import test from "node:test";
import { BajaCuponSchema, CrearCuponSchema, EditarCuponSchema, FiltroCuponesSchema } from "./cupon.schema.ts";

const valido = {
  codigo: "  promo_otono-26 ",
  tipo_beneficio: "PORCENTAJE",
  valor: "12.50",
  vigente_desde: "2026-10-01T00:00:00-03:00",
  vigente_hasta: "2026-10-31T23:59:59-03:00",
};

const camposConError = (resultado: { success: boolean; error?: { flatten: () => { fieldErrors: object } } }) =>
  Object.keys(resultado.error?.flatten().fieldErrors ?? {});

test("CrearCuponSchema normaliza el código y aplica los defaults de límites", () => {
  const parsed = CrearCuponSchema.parse(valido);
  assert.equal(parsed.codigo, "PROMO_OTONO-26");
  assert.equal(parsed.valor, "12.50");
  assert.equal(parsed.limite_uso_global, null);
  assert.equal(parsed.limite_uso_por_cliente, 1);
});

test("CrearCuponSchema rechaza código fuera de [A-Z0-9_-] o de 3 a 50 caracteres", () => {
  for (const codigo of ["AB", "A".repeat(51), "PROMO 10", "PROMO*10", "ÑANDÚ"]) {
    assert.deepEqual(camposConError(CrearCuponSchema.safeParse({ ...valido, codigo })), ["codigo"], codigo);
  }
});

test("CrearCuponSchema: valor positivo con hasta 2 decimales, como string; porcentaje menor que 100", () => {
  for (const valor of ["0", "-5", "10.001", "abc", "", 10]) {
    assert.deepEqual(camposConError(CrearCuponSchema.safeParse({ ...valido, valor })), ["valor"], String(valor));
  }
  assert.deepEqual(camposConError(CrearCuponSchema.safeParse({ ...valido, valor: "100" })), ["valor"]);
  assert.equal(CrearCuponSchema.safeParse({ ...valido, valor: "99.99" }).success, true);
  assert.equal(CrearCuponSchema.safeParse({ ...valido, tipo_beneficio: "MONTO_FIJO", valor: "15000" }).success, true);
  assert.deepEqual(camposConError(CrearCuponSchema.safeParse({ ...valido, tipo_beneficio: "REGALO" })), ["tipo_beneficio"]);
});

test("CrearCuponSchema: fechas ISO con zona y ventana no invertida", () => {
  assert.deepEqual(camposConError(CrearCuponSchema.safeParse({ ...valido, vigente_desde: "2026-10-01" })), ["vigente_desde"]);
  assert.deepEqual(
    camposConError(CrearCuponSchema.safeParse({ ...valido, vigente_hasta: valido.vigente_desde })),
    ["vigente_hasta"],
  );
  assert.deepEqual(
    camposConError(CrearCuponSchema.safeParse({ ...valido, vigente_hasta: "2026-09-01T00:00:00Z" })),
    ["vigente_hasta"],
  );
});

test("CrearCuponSchema: límites enteros positivos (global admite null) y body estricto", () => {
  assert.equal(CrearCuponSchema.parse({ ...valido, limite_uso_global: 100 }).limite_uso_global, 100);
  for (const limite of [0, -1, 1.5, "10"]) {
    assert.deepEqual(camposConError(CrearCuponSchema.safeParse({ ...valido, limite_uso_global: limite })), ["limite_uso_global"]);
    assert.deepEqual(
      camposConError(CrearCuponSchema.safeParse({ ...valido, limite_uso_por_cliente: limite })),
      ["limite_uso_por_cliente"],
    );
  }
  assert.equal(CrearCuponSchema.safeParse({ ...valido, limite_uso_por_cliente: null }).success, false);
  assert.equal(CrearCuponSchema.safeParse({ ...valido, is_active: false }).success, false);
});

test("EditarCuponSchema: estricto, sin código, al menos un campo y mismas validaciones", () => {
  assert.equal(EditarCuponSchema.safeParse({}).success, false);
  assert.equal(EditarCuponSchema.safeParse({ codigo: "OTRO" }).success, false);
  assert.deepEqual(EditarCuponSchema.parse({ limite_uso_global: null }), { limite_uso_global: null });
  assert.deepEqual(camposConError(EditarCuponSchema.safeParse({ valor: "1.234" })), ["valor"]);
  assert.deepEqual(camposConError(EditarCuponSchema.safeParse({ tipo_beneficio: "PORCENTAJE", valor: "100" })), ["valor"]);
  assert.deepEqual(
    camposConError(EditarCuponSchema.safeParse({ vigente_desde: valido.vigente_hasta, vigente_hasta: valido.vigente_desde })),
    ["vigente_hasta"],
  );
});

test("BajaCuponSchema y FiltroCuponesSchema", () => {
  assert.equal(BajaCuponSchema.parse({ motivo: "  Fin de campaña  " }).motivo, "Fin de campaña");
  for (const motivo of ["ab", "   x  ", "a".repeat(501)]) assert.equal(BajaCuponSchema.safeParse({ motivo }).success, false);
  assert.equal(BajaCuponSchema.safeParse({ motivo: "Fin de campaña", extra: 1 }).success, false);
  assert.deepEqual(FiltroCuponesSchema.parse({}), { estado: "ACTIVOS" });
  assert.deepEqual(FiltroCuponesSchema.parse({ estado: "TODOS", q: " swat " }), { estado: "TODOS", q: "SWAT" });
  assert.equal(FiltroCuponesSchema.safeParse({ estado: "BORRADOS" }).success, false);
});

test("mensajes en español: campos faltantes, tipos inválidos y campos no permitidos", () => {
  const mensajes = (resultado: { success: boolean; error?: { flatten: () => { fieldErrors: Record<string, string[] | undefined>; formErrors: string[] } } }) =>
    resultado.error?.flatten();
  assert.deepEqual(mensajes(BajaCuponSchema.safeParse({}))?.fieldErrors.motivo, ["El motivo es obligatorio"]);
  assert.deepEqual(mensajes(BajaCuponSchema.safeParse({ motivo: 5 }))?.fieldErrors.motivo, ["El motivo debe ser texto"]);
  assert.deepEqual(mensajes(BajaCuponSchema.safeParse({ motivo: "Fin", extra: 1 }))?.formErrors, [
    "El cuerpo contiene campos no permitidos",
  ]);
  assert.ok(mensajes(EditarCuponSchema.safeParse({ codigo: "OTRO" }))?.formErrors.includes("El cuerpo contiene campos no permitidos"));

  const faltantes = mensajes(CrearCuponSchema.safeParse({}))?.fieldErrors;
  assert.deepEqual(faltantes?.codigo, ["El código es obligatorio"]);
  assert.deepEqual(faltantes?.valor, ["El valor es obligatorio"]);
  assert.deepEqual(faltantes?.vigente_desde, ["La fecha es obligatoria"]);
  assert.deepEqual(faltantes?.vigente_hasta, ["La fecha es obligatoria"]);
  assert.ok(faltantes?.tipo_beneficio?.[0]?.startsWith("El tipo de beneficio"));

  const tipos = mensajes(CrearCuponSchema.safeParse({ ...valido, limite_uso_global: "5", limite_uso_por_cliente: "1" }))?.fieldErrors;
  assert.deepEqual(tipos?.limite_uso_global, ["El límite debe ser un número entero"]);
  assert.deepEqual(tipos?.limite_uso_por_cliente, ["El límite debe ser un número entero"]);

  assert.deepEqual(mensajes(FiltroCuponesSchema.safeParse({ estado: "BORRADOS" }))?.fieldErrors.estado, [
    "El estado debe ser ACTIVOS, INACTIVOS o TODOS",
  ]);
  assert.deepEqual(mensajes(FiltroCuponesSchema.safeParse({ q: "A".repeat(51) }))?.fieldErrors.q, [
    "La búsqueda admite hasta 50 caracteres",
  ]);
});

test("mensajes en español: body null o array en crear, editar y baja (F02)", () => {
  for (const schema of [CrearCuponSchema, EditarCuponSchema, BajaCuponSchema]) {
    for (const body of [null, [], [{ motivo: "Fin de campaña" }]]) {
      const resultado = schema.safeParse(body);
      assert.equal(resultado.success, false);
      assert.deepEqual(resultado.error?.flatten(), { formErrors: ["El cuerpo debe ser un objeto JSON"], fieldErrors: {} });
    }
  }
});
