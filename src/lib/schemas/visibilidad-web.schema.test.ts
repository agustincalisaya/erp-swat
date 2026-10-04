import assert from "node:assert/strict";
import test from "node:test";
import { BajaContenidoWebSchema, CambiarVisibilidadWebSchema } from "./ecommerce.schema.ts";

/** HU-E5 (spec E §2.5; task_relos.md §2, D1) — schemas de visibilidad y baja. */

const camposConError = (resultado: { success: boolean; error?: { flatten: () => { fieldErrors: object } } }) =>
  Object.keys(resultado.error?.flatten().fieldErrors ?? {});

const mensajeRaiz = (resultado: { success: boolean; error?: { flatten: () => { formErrors: string[] } } }) =>
  resultado.error?.flatten().formErrors[0];

test("CambiarVisibilidadWebSchema acepta ocultar/mostrar con y sin motivo, y recorta el motivo", () => {
  assert.deepEqual(CambiarVisibilidadWebSchema.parse({ visibilidad_web: false }), { visibilidad_web: false });
  assert.deepEqual(CambiarVisibilidadWebSchema.parse({ visibilidad_web: true, motivo: "  Vuelve la temporada  " }), {
    visibilidad_web: true,
    motivo: "Vuelve la temporada",
  });
});

test("CambiarVisibilidadWebSchema: visibilidad obligatoria y booleana", () => {
  for (const body of [{}, { visibilidad_web: "false" }, { visibilidad_web: 0 }, { visibilidad_web: null }]) {
    assert.deepEqual(camposConError(CambiarVisibilidadWebSchema.safeParse(body)), ["visibilidad_web"], JSON.stringify(body));
  }
  const sinCampo = CambiarVisibilidadWebSchema.safeParse({});
  assert.equal(sinCampo.error?.flatten().fieldErrors.visibilidad_web?.[0], "La visibilidad web es obligatoria");
});

test("CambiarVisibilidadWebSchema: motivo opcional pero, si viene, no vacío ni solo espacios, texto y ≤ 500", () => {
  for (const motivo of ["", "   ", 42, "x".repeat(501)]) {
    assert.deepEqual(
      camposConError(CambiarVisibilidadWebSchema.safeParse({ visibilidad_web: false, motivo })),
      ["motivo"],
      JSON.stringify(motivo),
    );
  }
  assert.equal(CambiarVisibilidadWebSchema.safeParse({ visibilidad_web: false, motivo: "x".repeat(500) }).success, true);
});

test("BajaContenidoWebSchema: deletion_reason obligatorio, recortado y ≤ 500", () => {
  assert.deepEqual(BajaContenidoWebSchema.parse({ deletion_reason: "  Discontinuado en la web  " }), {
    deletion_reason: "Discontinuado en la web",
  });
  for (const body of [{}, { deletion_reason: "" }, { deletion_reason: "    " }, { deletion_reason: null }, { deletion_reason: 7 }, { deletion_reason: "x".repeat(501) }]) {
    assert.deepEqual(camposConError(BajaContenidoWebSchema.safeParse(body)), ["deletion_reason"], JSON.stringify(body));
  }
  assert.equal(
    BajaContenidoWebSchema.safeParse({ deletion_reason: "   " }).error?.flatten().fieldErrors.deletion_reason?.[0],
    "El motivo de baja es obligatorio",
  );
});

test("cuerpo raíz inválido (null, array, texto, ausente): error de raíz en español en ambos schemas", () => {
  for (const schema of [CambiarVisibilidadWebSchema, BajaContenidoWebSchema]) {
    for (const cuerpo of [null, [], ["visibilidad_web"], "texto", 5, undefined]) {
      const r = schema.safeParse(cuerpo);
      assert.equal(r.success, false, JSON.stringify(cuerpo));
      assert.equal(mensajeRaiz(r), "El cuerpo debe ser un objeto JSON", JSON.stringify(cuerpo));
    }
  }
});

test("bodies estrictos: un campo extra (actor, deleted_by, is_active) se rechaza, no se descarta", () => {
  for (const extra of [{ actor_id: "otro" }, { deleted_by: "otro" }, { is_active: false }]) {
    const visibilidad = CambiarVisibilidadWebSchema.safeParse({ visibilidad_web: true, ...extra });
    assert.equal(visibilidad.success, false, JSON.stringify(extra));
    assert.equal(mensajeRaiz(visibilidad), "El cuerpo contiene campos no permitidos");
    const baja = BajaContenidoWebSchema.safeParse({ deletion_reason: "Motivo", ...extra });
    assert.equal(baja.success, false, JSON.stringify(extra));
    assert.equal(mensajeRaiz(baja), "El cuerpo contiene campos no permitidos");
  }
});
