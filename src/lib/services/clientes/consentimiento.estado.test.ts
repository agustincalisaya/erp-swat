import assert from "node:assert/strict";
import test from "node:test";
import { reducirConsentimientos, type ConsentimientoHecho, type EventoHecho } from "./consentimiento.estado.ts";

const cliente = "cliente-1";
const actor = "usuario-1";
const t1 = new Date("2026-01-01T10:00:00.000Z");
const t2 = new Date("2026-01-02T10:00:00.000Z");
const fila = (overrides: Partial<ConsentimientoHecho> = {}): ConsentimientoHecho => ({
  id: "c1", cliente_id: cliente, alcance: "VENTA_ASISTIDA", finalidad: "Tratamiento",
  fecha_consentimiento: t1, origen: "EXPRESO", registrado_por_id: actor,
  registrado_por_nombre: "Operador", is_active: true, ...overrides,
});
const evento = (overrides: Partial<EventoHecho> = {}): EventoHecho => ({
  id: "e1", cliente_id: cliente, consentimiento_id: "c1", tipo: "ACEPTACION_INICIAL",
  alcance: "VENTA_ASISTIDA", finalidad: "Tratamiento", fecha_evento: t1,
  usuario_id: actor, usuario_nombre: "Operador", solicitud_evento_id: null,
  motivo: null, is_active: true, ...overrides,
});

test("legado activo, inactivo y AMBOS solo aporta historial", () => {
  const lectura = reducirConsentimientos(cliente, [
    fila({ id: "l1", origen: "LEGADO_SIN_ACREDITACION_EXPRESA", registrado_por_id: null, alcance: "AMBOS" }),
    fila({ id: "l2", origen: "LEGADO_SIN_ACREDITACION_EXPRESA", registrado_por_id: null, is_active: false }),
  ], []);
  assert.equal(lectura.estados.VENTA_ASISTIDA.estado, "PENDIENTE_REGULARIZACION");
  assert.equal(lectura.estados.COMUNICACIONES_COMERCIALES.estado, "PENDIENTE_REGULARIZACION");
  assert.equal(lectura.historial.length, 2);
  assert.ok(lectura.historial.every((item) => item.resultado === "Legado: no acredita aceptación expresa"));
});

test("aceptación expresa, rechazo comercial y solicitud pendiente son estados distintos", () => {
  const lectura = reducirConsentimientos(cliente, [fila()], [
    evento(),
    evento({ id: "r1", tipo: "RECHAZO_COMERCIAL", alcance: "COMUNICACIONES_COMERCIALES", finalidad: "Comercial", consentimiento_id: null }),
    evento({ id: "s1", tipo: "SOLICITUD_REVOCACION", fecha_evento: t2 }),
  ]);
  assert.equal(lectura.estados.VENTA_ASISTIDA.estado, "ACEPTADO");
  assert.equal(lectura.estados.VENTA_ASISTIDA.solicitudes_pendientes.length, 1);
  assert.equal(lectura.estados.VENTA_ASISTIDA.usuario_ultima_manifestacion, "Operador");
  assert.equal(lectura.estados.COMUNICACIONES_COMERCIALES.estado, "RECHAZADO");
});

test("referencia ajena, actor distinto, aceptación huérfana y simultaneidad producen error", () => {
  for (const [filas, eventos] of [
    [[fila()], [evento({ cliente_id: "otro" })]],
    [[fila()], [evento({ usuario_id: "otro" })]],
    [[fila()], []],
    [[fila()], [evento(), evento({ id: "e2", tipo: "NUEVA_ACEPTACION" })]],
  ] as [ConsentimientoHecho[], EventoHecho[]][]) {
    assert.equal(reducirConsentimientos(cliente, filas, eventos).estados.VENTA_ASISTIDA.estado, "ERROR_INTEGRIDAD");
  }
});

test("revocación coherente exige solicitud para tratamiento y conserva estado revocado", () => {
  const lectura = reducirConsentimientos(cliente, [fila()], [
    evento(),
    evento({ id: "s1", tipo: "SOLICITUD_REVOCACION", fecha_evento: t2 }),
    evento({ id: "r1", tipo: "REVOCACION_EJECUTADA", fecha_evento: new Date("2026-01-03T10:00:00Z"), solicitud_evento_id: "s1" }),
  ]);
  assert.equal(lectura.estados.VENTA_ASISTIDA.estado, "REVOCADO");
  assert.equal(lectura.estados.VENTA_ASISTIDA.solicitudes_pendientes.length, 0);
  assert.equal(lectura.estados.VENTA_ASISTIDA.ultima_revocacion_evento_id, "r1");
});

test("comercial se revoca sin solicitud y nueva aceptación exige otra fila expresa", () => {
  const comercial = fila({ id: "c-comercial", alcance: "COMUNICACIONES_COMERCIALES", finalidad: "Comercial" });
  const comercialNuevo = fila({ id: "c-nuevo", alcance: "COMUNICACIONES_COMERCIALES", finalidad: "Comercial", fecha_consentimiento: new Date("2026-01-04T10:00:00Z") });
  const hechos = [
    evento({ id: "a1", alcance: "COMUNICACIONES_COMERCIALES", finalidad: "Comercial", consentimiento_id: comercial.id }),
    evento({ id: "r1", tipo: "REVOCACION_EJECUTADA", alcance: "COMUNICACIONES_COMERCIALES", finalidad: "Comercial", consentimiento_id: comercial.id, fecha_evento: t2 }),
  ];
  const revocado = reducirConsentimientos(cliente, [comercial], hechos);
  assert.equal(revocado.estados.COMUNICACIONES_COMERCIALES.estado, "REVOCADO");
  assert.equal(revocado.estados.COMUNICACIONES_COMERCIALES.ultima_revocacion_evento_id, "r1");
  const restaurado = reducirConsentimientos(cliente, [comercial, comercialNuevo], [
    ...hechos,
    evento({ id: "a2", tipo: "NUEVA_ACEPTACION", alcance: "COMUNICACIONES_COMERCIALES", finalidad: "Comercial", consentimiento_id: comercialNuevo.id, fecha_evento: comercialNuevo.fecha_consentimiento }),
  ]);
  assert.equal(restaurado.estados.COMUNICACIONES_COMERCIALES.estado, "ACEPTADO");
  assert.equal(restaurado.estados.COMUNICACIONES_COMERCIALES.consentimiento_vigente_id, "c-nuevo");
  assert.equal(restaurado.historial.filter((hecho) => hecho.clase === "EVENTO").length, 3);
});

test("doble solicitud, doble resolución y causalidad simultánea dan error de integridad", () => {
  const solicitud = evento({ id: "s1", tipo: "SOLICITUD_REVOCACION", fecha_evento: t2 });
  const rechazo = evento({ id: "d1", tipo: "SOLICITUD_RECHAZADA", fecha_evento: new Date("2026-01-03T10:00:00Z"), solicitud_evento_id: "s1", motivo: "No procede" });
  for (const hechos of [
    [evento(), solicitud, evento({ id: "s2", tipo: "SOLICITUD_REVOCACION", fecha_evento: new Date("2026-01-03T10:00:00Z") })],
    [evento(), solicitud, rechazo, evento({ id: "d2", tipo: "SOLICITUD_RECHAZADA", fecha_evento: new Date("2026-01-04T10:00:00Z"), solicitud_evento_id: "s1", motivo: "Otra vez" })],
    [evento(), evento({ id: "s3", tipo: "SOLICITUD_REVOCACION", fecha_evento: t1 })],
  ]) assert.equal(reducirConsentimientos(cliente, [fila()], hechos).estados.VENTA_ASISTIDA.estado, "ERROR_INTEGRIDAD");
});
