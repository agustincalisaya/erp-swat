import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ConsultarAuditoriaVentasQuerySchema } from "../../schemas/ventas.schema.ts";

/**
 * Nivel 1 de HU-B6 (source-regex + schema, sin DB) — mismo patrón que
 * `cuenta-corriente.service.test.ts`: `auditoria-ventas.service.ts` importa
 * `server-only`/prisma y no se puede cargar en Node sin base. El
 * comportamiento real (alcance del Supervisor, filtros contra datos, cadena
 * de hashes) se verifica en `auditoria-ventas.integration.test.ts`
 * (`npm run test:integration:b6`) y `auditoria-ventas.http.integration.test.ts`.
 */

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const sinComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const servicio = leer("./auditoria-ventas.service.ts");
const ruta = leer("../../../app/api/ventas/auditoria/route.ts");
const rutaCodigo = sinComentarios(ruta);

function funcion(nombre: string): string {
  const inicio = servicio.indexOf(`export async function ${nombre}`);
  assert.ok(inicio > -1, `no se encontró ${nombre}`);
  const fin = servicio.indexOf("\n// ──", inicio + 10);
  return servicio.slice(inicio, fin === -1 ? undefined : fin);
}

const obtener = funcion("obtenerLogsVentas");
const verificar = funcion("verificarCadenaHashesVentas");
const resolverNivel = funcion("resolverNivelAccesoAuditoriaVentas");

// ── Schema del query ────────────────────────────────────────────────────────

test("verificar_integridad: 'false' (string) se parsea como false — no como true (z.coerce.boolean)", () => {
  assert.equal(ConsultarAuditoriaVentasQuerySchema.parse({ verificar_integridad: "false" }).verificar_integridad, false);
  assert.equal(ConsultarAuditoriaVentasQuerySchema.parse({ verificar_integridad: "true" }).verificar_integridad, true);
  assert.equal(ConsultarAuditoriaVentasQuerySchema.parse({}).verificar_integridad, false);
});

test("verificar_integridad: '0', '1' y strings arbitrarios se rechazan (solo 'true'/'false')", () => {
  for (const v of ["0", "1", "yes", ""]) {
    assert.equal(ConsultarAuditoriaVentasQuerySchema.safeParse({ verificar_integridad: v }).success, false, v);
  }
});

test("paginación: page/page_size con defaults 1/20 y tope 50 (no pagina/por_pagina)", () => {
  const def = ConsultarAuditoriaVentasQuerySchema.parse({});
  assert.equal(def.page, 1);
  assert.equal(def.page_size, 20);
  assert.equal(ConsultarAuditoriaVentasQuerySchema.parse({ page: "3", page_size: "50" }).page, 3);
  assert.equal(ConsultarAuditoriaVentasQuerySchema.safeParse({ page_size: "51" }).success, false);
  assert.equal(ConsultarAuditoriaVentasQuerySchema.safeParse({ page: "0" }).success, false);
  assert.doesNotMatch(servicio, /por_pagina|pagina\b/);
});

test("tipo_evento: enum de 4 valores, incluido venta:excepcion_credito_resuelta", () => {
  for (const t of [
    "venta:anulacion_pedido",
    "venta:descuento_fuera_margen",
    "venta:cambio_precio_manual",
    "venta:excepcion_credito_resuelta",
  ]) {
    assert.equal(ConsultarAuditoriaVentasQuerySchema.safeParse({ tipo_evento: t }).success, true, t);
  }
  assert.equal(ConsultarAuditoriaVentasQuerySchema.safeParse({ tipo_evento: "venta:turno_abierto" }).success, false);
});

test("pedido_venta_id/usuario_id deben ser UUID; fechas se coercionan", () => {
  assert.equal(ConsultarAuditoriaVentasQuerySchema.safeParse({ pedido_venta_id: "no-uuid" }).success, false);
  assert.equal(ConsultarAuditoriaVentasQuerySchema.safeParse({ usuario_id: "no-uuid" }).success, false);
  const q = ConsultarAuditoriaVentasQuerySchema.parse({ fecha_desde: "2026-01-01", fecha_hasta: "2026-01-31" });
  assert.ok(q.fecha_desde instanceof Date && q.fecha_hasta instanceof Date);
});

// ── Mapeo tipo_evento → accion ──────────────────────────────────────────────

test("mapeo tipo_evento → accion coincide con los valores reales del listener", () => {
  assert.match(servicio, /"venta:descuento_fuera_margen": \["DESCUENTO_FUERA_MARGEN"\]/);
  assert.match(servicio, /"venta:cambio_precio_manual": \["CAMBIO_PRECIO_MANUAL"\]/);
  assert.match(
    servicio,
    /"venta:excepcion_credito_resuelta": \["EXCEPCION_CREDITO_APROBADA", "EXCEPCION_CREDITO_RECHAZADA"\]/,
  );
  // Placeholder de anulación (decisión 5): sin DELETE_LOGICO en el filtro.
  assert.match(servicio, /"venta:anulacion_pedido": \["ANULACION_PEDIDO"\]/);
  assert.doesNotMatch(sinComentarios(servicio), /DELETE_LOGICO/);

  const listener = leer("../../events/listeners/audit-log.listener.ts");
  for (const accion of [
    "DESCUENTO_FUERA_MARGEN",
    "CAMBIO_PRECIO_MANUAL",
    "EXCEPCION_CREDITO_APROBADA",
    "EXCEPCION_CREDITO_RECHAZADA",
  ]) {
    assert.match(listener, new RegExp(`"${accion}"`), accion);
  }
});

test("filtro de dominio fijo por accion (nunca sin filtrar): sin tipo_evento usa la unión de todas", () => {
  assert.match(obtener, /accion:\s*\{\s*in:\s*filtros\.tipo_evento\s*\?\s*ACCION_POR_TIPO_EVENTO\[filtros\.tipo_evento\]\s*:\s*\[\.\.\.TODAS_LAS_ACCIONES_MODULO_B\]/);
});

// ── Filtro pedido_venta_id (decisión 10) ────────────────────────────────────

test("pedido_venta_id: OR entre registro_id y el path JSON valor_nuevo.pedido_venta_id", () => {
  assert.match(
    obtener,
    /if \(filtros\.pedido_venta_id\)[\s\S]*?OR:\s*\[\s*\{\s*registro_id:\s*filtros\.pedido_venta_id\s*\},\s*\{\s*valor_nuevo:\s*\{\s*path:\s*\["pedido_venta_id"\],\s*equals:\s*filtros\.pedido_venta_id/,
  );
});

// ── fecha_hasta (decisión 9) ────────────────────────────────────────────────

test("fecha_hasta se extiende a fin de día UTC (23:59:59.999), mismo criterio que HU-A6", () => {
  assert.match(servicio, /Date\.UTC\([\s\S]*?23, 59, 59, 999,?\s*\)/);
  assert.match(obtener, /lte:\s*finDeDia\(filtros\.fecha_hasta\)/);
});

// ── Gate y alcance (decisiones 4, 6, 8) ─────────────────────────────────────

test("los permisos coinciden con los códigos sembrados en el seed", () => {
  assert.match(servicio, /PERMISO_AUDITORIA_LEER_FORENSE = "auditoria:leer_forense"/);
  assert.match(servicio, /PERMISO_VENTAS_LEER_LOG_OPERATIVO = "ventas:leer_log_operativo"/);
  const seed = leer("../../../../prisma/seed.ts");
  assert.match(seed, /"auditoria:leer_forense"/);
  assert.match(seed, /"ventas:leer_log_operativo"/);
  // No se usa auditoria:leer_historico como gate.
  assert.doesNotMatch(sinComentarios(servicio), /leer_historico/);
});

test("resolución de nivel: leer_forense se evalúa ANTES que leer_log_operativo (precedencia MASTER)", () => {
  const iForense = resolverNivel.indexOf("PERMISO_AUDITORIA_LEER_FORENSE");
  const iOperativo = resolverNivel.indexOf("PERMISO_VENTAS_LEER_LOG_OPERATIVO");
  assert.ok(iForense > -1 && iOperativo > iForense);
  assert.match(resolverNivel, /PERMISO_AUDITORIA_LEER_FORENSE\)\) return "AUDITOR"/);
  assert.match(resolverNivel, /PERMISO_VENTAS_LEER_LOG_OPERATIVO\)\) return "SUPERVISOR"/);
  assert.match(resolverNivel, /return null/);
});

test("obtenerLogsVentas: sin ninguno de los dos permisos → FORBIDDEN, antes de tocar la base", () => {
  const iGate = obtener.indexOf("nivel === null");
  const iQuery = obtener.indexOf("prisma.auditLog");
  assert.ok(iGate > -1 && iQuery > iGate);
  assert.match(obtener, /nivel === null\)\s*\{\s*throw new ServiceError\(\s*"FORBIDDEN"/);
});

test("verificar_integridad con Supervisor corta con 403 ANTES de cualquier consulta", () => {
  const iCorte = obtener.indexOf("VERIFICACION_INTEGRIDAD_NO_DISPONIBLE");
  const iQuery = obtener.indexOf("prisma.auditLog");
  assert.ok(iCorte > -1 && iCorte < iQuery);
  assert.match(obtener, /filtros\.verificar_integridad && nivel !== "AUDITOR"/);
  assert.match(
    servicio,
    /La verificación de integridad de la cadena SHA-256 está reservada al rol Auditor/,
  );
});

test("alcance del Supervisor: UNA query con OR (usuario_id + path JSON solicitante) y paginación en base", () => {
  assert.match(
    obtener,
    /nivel === "SUPERVISOR"[\s\S]*?OR:\s*\[\s*\{\s*usuario_id:\s*sesion\.userId\s*\},\s*\{\s*valor_nuevo:\s*\{\s*path:\s*\["usuario_solicitante_id"\],\s*equals:\s*sesion\.userId/,
  );
  // Paginación con skip/take en la misma query — no en memoria.
  assert.match(obtener, /skip:\s*\(filtros\.page - 1\) \* filtros\.page_size/);
  assert.match(obtener, /take:\s*filtros\.page_size/);
  assert.doesNotMatch(obtener, /\.slice\(|\.filter\(/);
  // Una sola llamada a findMany.
  assert.equal((obtener.match(/auditLog\.findMany/g) ?? []).length, 1);
});

test("el Auditor no recibe filtro de alcance adicional (el OR de alcance es exclusivo de SUPERVISOR)", () => {
  const bloques = obtener.match(/if \(nivel === "SUPERVISOR"\)/g) ?? [];
  assert.equal(bloques.length, 1);
});

test("detalle: valor_anterior/valor_nuevo se devuelven sin condicionarlos al nivel de acceso (decisión 8)", () => {
  assert.match(obtener, /valor_anterior:\s*r\.valor_anterior/);
  assert.match(obtener, /valor_nuevo:\s*r\.valor_nuevo/);
});

test("respuesta: shape { registros, total, page, page_size, verificacion_integridad? }", () => {
  assert.match(obtener, /registros:[\s\S]*total,\s*page:\s*filtros\.page,\s*page_size:\s*filtros\.page_size/);
  assert.match(obtener, /listado\.verificacion_integridad = await verificarCadenaHashesVentas\(\)/);
});

// ── verificarCadenaHashesVentas (decisión 1) ────────────────────────────────

test("verificarCadenaHashesVentas: recorre TODA la cadena (sin where) y cuenta solo acciones de Módulo B", () => {
  assert.match(verificar, /auditLog\.findMany\(\{\s*orderBy:\s*\{\s*created_at:\s*"asc"\s*\}/);
  assert.doesNotMatch(verificar, /where:/);
  assert.match(verificar, /TODAS_LAS_ACCIONES_MODULO_B\.includes\(registro\.accion\)/);
  assert.match(verificar, /calcularHashEncadenado/);
  assert.match(verificar, /HASH_GENESIS/);
});

test("el servicio no reutiliza las verificaciones de A/D ni funciones inexistentes de Módulo D", () => {
  assert.doesNotMatch(sinComentarios(servicio), /verificarCadenaHashesInventario|verificarCadenaIntegridad|verificarCadenaHashesIntegridad/);
  assert.doesNotMatch(sinComentarios(servicio), /listarEventosPorDominio/);
  assert.doesNotMatch(servicio, /services\/auditoria\//);
});

test("el servicio es de solo lectura sobre AuditLog: sin create/update/delete", () => {
  assert.doesNotMatch(servicio, /auditLog\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(servicio, /\$transaction/);
});

// ── Route Handler ───────────────────────────────────────────────────────────

test("route.ts: withAuth + resolución manual; sin prisma ni lógica de negocio", () => {
  assert.match(ruta, /export const GET = withAuth\(/);
  assert.doesNotMatch(rutaCodigo, /withPermission/);
  assert.doesNotMatch(ruta, /@\/lib\/db\/prisma/);
  assert.doesNotMatch(ruta, /\$transaction/);
  assert.match(ruta, /resolverNivelAccesoAuditoriaVentas\(session\.userId\)/);
  assert.match(ruta, /ConsultarAuditoriaVentasQuerySchema\.safeParse/);
  assert.match(ruta, /obtenerLogsVentas\(parsed\.data, session\)/);
});

test("route.ts: 403 FORBIDDEN sin permisos se resuelve antes de parsear el query; ambos 403 mapeados", () => {
  assert.ok(ruta.indexOf('code: "FORBIDDEN"') < ruta.indexOf("safeParse"));
  assert.match(ruta, /VERIFICACION_INTEGRIDAD_NO_DISPONIBLE:\s*403/);
});
