/**
 * HU-D8 T01 — reglas puras del historial propio y schema de filtros
 * (`docs/modulos/modulo D/HU8_TASKS.md`). Runner nativo de Node:
 *
 *   node --experimental-strip-types --test src/lib/services/auditoria/historial-propio.reglas.test.ts
 *
 * El borde exacto 23:59:59.999 ART se prueba acá, sobre el `where`: en la
 * base `created_at` lo fija PostgreSQL bajo el lock del ledger y
 * `audit_logs` es append-only, así que no se puede fabricar una fila con esa
 * hora (§6 de la task).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDEN_AUDIT_LOG,
  SELECT_HISTORIAL_PROPIO,
  construirWhereHistorialPropio,
  rangoCreatedAt,
  type RangoCreatedAt,
} from "./historial-propio.reglas.ts";
import { HistorialPropioFiltrosSchema } from "../../schemas/auditoria.schema.ts";

const incluye = (rango: RangoCreatedAt, instante: string) => {
  const t = new Date(instante).getTime();
  return (!rango.gte || rango.gte.getTime() <= t) && (!rango.lt || t < rango.lt.getTime());
};

test("D8-3 — un solo día va de las 00:00 ART a las 00:00 ART del día siguiente (exclusivo)", () => {
  const rango = rangoCreatedAt("2026-10-20", "2026-10-20")!;
  assert.equal(rango.gte?.toISOString(), "2026-10-20T03:00:00.000Z");
  assert.equal(rango.lt?.toISOString(), "2026-10-21T03:00:00.000Z");
});

test("D8-3 — borde 23:59 ART: el último milisegundo del día entra; la medianoche siguiente y el día anterior no", () => {
  const rango = rangoCreatedAt("2026-10-20", "2026-10-20")!;
  assert.equal(incluye(rango, "2026-10-21T02:59:59.999Z"), true, "20/10 23:59:59.999 ART");
  assert.equal(incluye(rango, "2026-10-21T03:00:00.000Z"), false, "21/10 00:00 ART");
  assert.equal(incluye(rango, "2026-10-20T02:59:59.999Z"), false, "19/10 23:59:59.999 ART");
  assert.equal(incluye(rango, "2026-10-20T03:00:00.000Z"), true, "20/10 00:00 ART");
});

test("D8-3 — regresión del lte a medianoche UTC: un registro de la tarde del día hasta queda incluido", () => {
  const rango = rangoCreatedAt(undefined, "2026-10-20")!;
  assert.equal(incluye(rango, "2026-10-20T18:00:00.000Z"), true, "20/10 15:00 ART");
});

test("D8-3 — extremos sueltos acotan solo de su lado; sin extremos no hay filtro de fecha", () => {
  assert.deepEqual(rangoCreatedAt("2026-10-20", undefined), { gte: new Date("2026-10-20T03:00:00.000Z") });
  assert.deepEqual(rangoCreatedAt(undefined, "2026-10-20"), { lt: new Date("2026-10-21T03:00:00.000Z") });
  assert.equal(rangoCreatedAt(), undefined);
  assert.equal(construirWhereHistorialPropio("U1", {}).created_at, undefined);
});

test("D8-3 — rango invertido o día inexistente → RangeError", () => {
  assert.throws(() => rangoCreatedAt("2026-10-21", "2026-10-20"), RangeError);
  assert.throws(() => rangoCreatedAt("2026-02-30", undefined), RangeError);
});

test("D8-1 — el usuario del where es siempre el recibido por parámetro, aunque los filtros traigan otro", () => {
  const filtrosMaliciosos = { accion: "LOGIN_EXITOSO", usuario_id: "OTRO", userId: "OTRO" } as unknown as {
    accion: string;
  };
  const where = construirWhereHistorialPropio("U1", filtrosMaliciosos);
  assert.deepEqual(where, { usuario_id: "U1", accion: "LOGIN_EXITOSO" });
});

test("D8-2 — orden estable created_at DESC, id DESC", () => {
  assert.deepEqual(ORDEN_AUDIT_LOG, [{ created_at: "desc" }, { id: "desc" }]);
});

test("D8-6 — la proyección es exactamente id, created_at, accion, tabla_afectada, registro_id", () => {
  assert.deepEqual(Object.keys(SELECT_HISTORIAL_PROPIO).sort(), [
    "accion",
    "created_at",
    "id",
    "registro_id",
    "tabla_afectada",
  ]);
  for (const prohibida of ["valor_anterior", "valor_nuevo", "hash_anterior", "hash_actual", "ip", "usuario_id", "usuario"]) {
    assert.equal(prohibida in SELECT_HISTORIAL_PROPIO, false, prohibida);
  }
});

test("D8-1 — el schema descarta usuario_id/userId sin validarlos (un valor malformado no da error)", () => {
  const r = HistorialPropioFiltrosSchema.safeParse({ usuario_id: "no-es-uuid", userId: "x", tabla_afectada: "usuarios" });
  assert.equal(r.success, true);
  assert.deepEqual(r.data, { page: 1, page_size: 25 });
});

test("schema — desde > hasta, día con otro formato y page_size > 100 son inválidos", () => {
  const invertido = HistorialPropioFiltrosSchema.safeParse({ fecha_desde: "2026-10-21", fecha_hasta: "2026-10-20" });
  assert.equal(invertido.success, false);
  assert.deepEqual(invertido.error?.flatten().fieldErrors.fecha_hasta?.length, 1);
  assert.equal(HistorialPropioFiltrosSchema.safeParse({ fecha_desde: "20/10/2026" }).success, false);
  assert.equal(HistorialPropioFiltrosSchema.safeParse({ fecha_desde: "2026-02-30" }).success, false);
  assert.equal(HistorialPropioFiltrosSchema.safeParse({ page_size: "101" }).success, false);
  assert.equal(HistorialPropioFiltrosSchema.safeParse({ page: "0" }).success, false);
});

test("schema — parámetros vacíos equivalen a no filtrar; page y page_size se coercionan", () => {
  const r = HistorialPropioFiltrosSchema.parse({ accion: "", fecha_desde: "", page: "2", page_size: "10" });
  assert.equal(r.accion, undefined);
  assert.equal(r.fecha_desde, undefined);
  assert.equal(r.page, 2);
  assert.equal(r.page_size, 10);
  assert.equal(HistorialPropioFiltrosSchema.parse({ fecha_desde: "2026-10-20", fecha_hasta: "2026-10-20" }).fecha_hasta, "2026-10-20");
});
