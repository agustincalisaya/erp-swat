import assert from "node:assert/strict";
import test from "node:test";
import {
  CrearPlantillaNotificacionSchema,
  DarDeBajaPlantillaNotificacionSchema,
  EditarPlantillaNotificacionBodySchema,
  EditarPlantillaNotificacionSchema,
  errorEdicion,
  ListarNotificacionesQuerySchema,
  NotificacionIdSchema,
} from "./notificaciones.schema.ts";

/** HU-F2 — task §7, Nivel 1: schemas de plantillas de notificación. */

const ALTA_VALIDA = {
  tipo_evento: "usuario:suspendido_automaticamente",
  asunto: "Usuario suspendido",
  cuerpo: "El usuario {{nombre_usuario}} fue suspendido.",
  prioridad_default: "CRITICA",
};

test("alta: body válido pasa", () => {
  assert.equal(CrearPlantillaNotificacionSchema.safeParse(ALTA_VALIDA).success, true);
});

test("alta: sin asunto falla", () => {
  const { asunto: _omitido, ...sinAsunto } = ALTA_VALIDA;
  assert.equal(CrearPlantillaNotificacionSchema.safeParse(sinAsunto).success, false);
});

test("alta: prioridad fuera del enum falla", () => {
  const resultado = CrearPlantillaNotificacionSchema.safeParse({
    ...ALTA_VALIDA,
    prioridad_default: "URGENTE",
  });
  assert.equal(resultado.success, false);
});

test("edición: parcial válido pasa", () => {
  assert.equal(EditarPlantillaNotificacionBodySchema.safeParse({ cuerpo: "Nuevo cuerpo" }).success, true);
});

test("edición: con tipo_evento falla con unrecognized_keys → CAMPO_INMUTABLE (mensaje textual del spec)", () => {
  const resultado = EditarPlantillaNotificacionBodySchema.safeParse({
    tipo_evento: "stock:umbral_critico_alcanzado",
    cuerpo: "x",
  });
  assert.equal(resultado.success, false);
  if (resultado.success) return;
  assert.ok(resultado.error.issues.some((i) => i.code === "unrecognized_keys"));
  assert.deepEqual(errorEdicion(resultado.error), {
    code: "CAMPO_INMUTABLE",
    message: "Unrecognized key(s) in object: 'tipo_evento'",
  });
});

test("edición: solo tipo_evento sigue siendo CAMPO_INMUTABLE aunque también falle el refine", () => {
  const resultado = EditarPlantillaNotificacionBodySchema.safeParse({ tipo_evento: "x" });
  assert.equal(resultado.success, false);
  if (resultado.success) return;
  assert.equal(errorEdicion(resultado.error).code, "CAMPO_INMUTABLE");
});

test("edición: otra clave desconocida → VALIDATION_ERROR", () => {
  const resultado = EditarPlantillaNotificacionBodySchema.safeParse({ cuerpo: "x", foo: 1 });
  assert.equal(resultado.success, false);
  if (resultado.success) return;
  assert.equal(errorEdicion(resultado.error).code, "VALIDATION_ERROR");
});

test("edición: body vacío {} falla con VALIDATION_ERROR (Punto abierto 8)", () => {
  const resultado = EditarPlantillaNotificacionBodySchema.safeParse({});
  assert.equal(resultado.success, false);
  if (resultado.success) return;
  assert.deepEqual(errorEdicion(resultado.error), {
    code: "VALIDATION_ERROR",
    message: "Debe indicar al menos un campo a modificar",
  });
});

test("edición: el schema textual del spec no se tocó (acepta {})", () => {
  assert.equal(EditarPlantillaNotificacionSchema.safeParse({}).success, true);
});

test("baja: sin deletion_reason falla", () => {
  assert.equal(DarDeBajaPlantillaNotificacionSchema.safeParse({}).success, false);
});

test("baja: deletion_reason solo espacios falla (.trim())", () => {
  assert.equal(DarDeBajaPlantillaNotificacionSchema.safeParse({ deletion_reason: "   " }).success, false);
});

test("baja: deletion_reason se recorta", () => {
  const resultado = DarDeBajaPlantillaNotificacionSchema.safeParse({ deletion_reason: "  motivo  " });
  assert.equal(resultado.success && resultado.data.deletion_reason, "motivo");
});

// ── HU-F3 — task §7 Nivel 1: query de la bandeja ─────────────────────────────

test("bandeja: defaults del spec", () => {
  assert.deepEqual(ListarNotificacionesQuerySchema.parse({}), {
    solo_no_leidas: false,
    page: 1,
    page_size: 20,
  });
});

test("bandeja: page_size 51 falla (máx. 50)", () => {
  assert.equal(ListarNotificacionesQuerySchema.safeParse({ page_size: "51" }).success, false);
  assert.equal(ListarNotificacionesQuerySchema.safeParse({ page_size: "50" }).success, true);
});

test("bandeja: prioridad fuera del enum falla", () => {
  assert.equal(ListarNotificacionesQuerySchema.safeParse({ prioridad: "URGENTE" }).success, false);
  assert.equal(ListarNotificacionesQuerySchema.parse({ prioridad: "CRITICA" }).prioridad, "CRITICA");
});

test("bandeja: solo_no_leidas=true parsea a true", () => {
  assert.equal(ListarNotificacionesQuerySchema.parse({ solo_no_leidas: "true" }).solo_no_leidas, true);
});

test("HALLAZGO (Punto abierto 6, Zod textual): solo_no_leidas=false parsea a TRUE", () => {
  // z.coerce.boolean() → Boolean("false") === true. Mismo defecto que HU-B6.
  assert.equal(ListarNotificacionesQuerySchema.parse({ solo_no_leidas: "false" }).solo_no_leidas, true);
});

test("notificación: id debe ser UUID", () => {
  assert.equal(NotificacionIdSchema.safeParse("no-uuid").success, false);
  assert.equal(NotificacionIdSchema.safeParse("9c1c70af-b0c6-4188-8771-3ad4e3a90940").success, true);
});
