import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Test source-regex sobre `prisma/seed.ts` (mismo patrón que
 * `presupuesto.service.test.ts` — sin DB, corre en el `npm test` default).
 * Complementa (no reemplaza) `rbac-hu-b8.integration.test.ts`
 * (`npm run test:integration:b8`), que sí verifica contra una base real.
 *
 * Cubre el mapeo confirmado de HU-B8 (task_HU-B8_roles_operativos_ventas.md):
 * CAJERO_POS agrupa 6 permisos, SUPERVISOR_VENTAS agrupa esos 6 más otros 4
 * exclusivos.
 */

const seed = readFileSync(new URL("../../../../prisma/seed.ts", import.meta.url), "utf8");

test("el seed define los roles CAJERO_POS y SUPERVISOR_VENTAS", () => {
  assert.match(seed, /nombre:\s*"CAJERO_POS"/);
  assert.match(seed, /nombre:\s*"SUPERVISOR_VENTAS"/);
});

test("cajero.seed y supervisor.ventas.seed quedan vinculados vía UsuarioRol a sus roles", () => {
  const bloqueCajero = seed.slice(seed.indexOf("permisosCajeroPos = ["), seed.indexOf("// ── Módulo B — Turno de caja"));
  assert.match(bloqueCajero, /usuario_id:\s*usuarioCajero\.id,\s*\n\s*rol_id:\s*rolCajeroPos\.id/);
  assert.match(bloqueCajero, /usuario_id:\s*usuarioSupervisorVentas\.id,\s*\n\s*rol_id:\s*rolSupervisorVentas\.id/);
});

test("CAJERO_POS agrupa exactamente los 6 permisos confirmados en el mapeo de HU-B8", () => {
  const inicio = seed.indexOf("const permisosCajeroPos = [");
  const bloque = seed.slice(inicio, seed.indexOf("];", inicio));

  for (const codigo of [
    "PERMISO_VENTAS_REGISTRAR_MOSTRADOR_ID",
    "PERMISO_VENTAS_GESTIONAR_TURNO_CAJA_ID",
    "PERMISO_VENTAS_EMITIR_COTIZACION_ID",
    "PERMISO_VENTAS_APLICAR_DESCUENTO_MARGEN_ID",
    "PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE_ID",
    "PERMISO_VENTAS_LEER_ID",
  ]) {
    assert.ok(bloque.includes(codigo), `permisosCajeroPos debería incluir ${codigo}`);
  }

  // Los 4 exclusivos de Supervisor NO deben estar en la lista de Cajero.
  for (const codigo of [
    "PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO_ID",
    "PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO_ID",
    "PERMISO_VENTAS_ANULAR_PEDIDO_ID",
    "PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID",
  ]) {
    assert.ok(!bloque.includes(codigo), `permisosCajeroPos NO debería incluir ${codigo}`);
  }
});

test("SUPERVISOR_VENTAS agrupa los 6 de CAJERO_POS (spread) más sus 4 permisos exclusivos", () => {
  const inicio = seed.indexOf("const permisosSupervisorVentas = [");
  const bloque = seed.slice(inicio, seed.indexOf("];", inicio));

  assert.match(bloque, /\.\.\.permisosCajeroPos/);

  for (const codigo of [
    "PERMISO_VENTAS_AUTORIZAR_EXCEPCION_DESCUENTO_ID",
    "PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO_ID",
    "PERMISO_VENTAS_ANULAR_PEDIDO_ID",
    "PERMISO_VENTAS_LEER_LOG_OPERATIVO_ID",
  ]) {
    assert.ok(bloque.includes(codigo), `permisosSupervisorVentas debería incluir ${codigo}`);
  }
});

test("cuentas_por_pagar:leer NO se asigna a CAJERO_POS (fuera de alcance de HU-B8, spec_modulo_G.md §5 queda pendiente)", () => {
  const inicioPermiso = seed.indexOf("permisoCxpLeer.id");
  assert.ok(inicioPermiso !== -1);
  // El único loop que asigna cuentas_por_pagar:leer itera sobre
  // [rolTesorero, rolAuditor, rolAdministrador] — rolCajeroPos no debe
  // aparecer en ese loop.
  const inicioLoop = seed.lastIndexOf("for (const rol of [", seed.indexOf("permiso_id: permisoCxpLeer.id"));
  const finLoop = seed.indexOf(")", inicioLoop);
  const cabeceraLoop = seed.slice(inicioLoop, finLoop);
  assert.ok(!cabeceraLoop.includes("rolCajeroPos"), "rolCajeroPos no debería estar en el loop de cuentas_por_pagar:leer");
});
