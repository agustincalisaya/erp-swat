import assert from "node:assert/strict";
import test from "node:test";
import { RegularizarConsentimientoSchema, TransicionConsentimientoSchema } from "./consentimientos.schema.ts";

test("HU-C4 valida una única finalidad y una decisión explícita", () => {
  for (const alcance of ["VENTA_ASISTIDA", "COMUNICACIONES_COMERCIALES"]) {
    assert.equal(RegularizarConsentimientoSchema.safeParse({ alcance, decision: "ACEPTA" }).success, true);
  }
  assert.equal(RegularizarConsentimientoSchema.safeParse({ alcance: "COMUNICACIONES_COMERCIALES", decision: "RECHAZA" }).success, true);
  for (const input of [
    { alcance: "VENTA_ASISTIDA", decision: "RECHAZA" },
    { alcance: "AMBOS", decision: "ACEPTA" },
    { alcance: "VENTA_ASISTIDA", decision: null },
    { alcance: "COMUNICACIONES_COMERCIALES" },
    { alcance: "VENTA_ASISTIDA", decision: "ACEPTA", cliente_id: "otro" },
  ]) assert.equal(RegularizarConsentimientoSchema.safeParse(input).success, false);
});

const id = "11111111-1111-4111-8111-111111111111";
test("HU-C4 etapa 3 discrimina operaciones y rechaza autoridad espuria", () => {
  for (const input of [
    { operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", consentimiento_id: id },
    { operacion: "SOLICITAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: id },
    { operacion: "EJECUTAR_REVOCACION", alcance: "VENTA_ASISTIDA", consentimiento_id: id, solicitud_evento_id: id },
    { operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: id, solicitud_evento_id: id, motivo: "  No procede  " },
    { operacion: "NUEVA_ACEPTACION", alcance: "COMUNICACIONES_COMERCIALES", revocacion_evento_id: id, aceptacion_expresa: true },
  ]) assert.equal(TransicionConsentimientoSchema.safeParse(input).success, true);

  for (const input of [
    { operacion: "REVOCAR_COMERCIAL", alcance: "VENTA_ASISTIDA", consentimiento_id: id },
    { operacion: "SOLICITAR_REVOCACION", alcance: "AMBOS", consentimiento_id: id },
    { operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: id, solicitud_evento_id: id, motivo: "   " },
    { operacion: "RECHAZAR_SOLICITUD", alcance: "VENTA_ASISTIDA", consentimiento_id: id, solicitud_evento_id: id },
    { operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA", revocacion_evento_id: id },
    { operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA", revocacion_evento_id: id, aceptacion_expresa: false },
    { operacion: "NUEVA_ACEPTACION", alcance: "VENTA_ASISTIDA", revocacion_evento_id: id, aceptacion_expresa: true, usuario_id: id },
    { operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", consentimiento_id: id, fecha_evento: new Date() },
    { operacion: "REVOCAR_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", consentimiento_id: null },
  ]) assert.equal(TransicionConsentimientoSchema.safeParse(input).success, false);
});
