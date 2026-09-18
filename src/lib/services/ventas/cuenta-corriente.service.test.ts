import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `cuenta-corriente.service.ts` (mismo patrón que
 * `pedido-venta.service.test.ts`: `import "server-only"` impide importarlo en
 * Node sin mock de prisma). Verifican el CONTRATO a nivel de código fuente;
 * el comportamiento real (dentro/fuera de límite, aprobar, rechazar,
 * transición inválida, evento sensible) se verifica contra una base real en
 * `cuenta-corriente.integration.test.ts` (opt-in, `npm run test:integration:b5`).
 */

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const fuente = leer("./cuenta-corriente.service.ts");

function funcion(nombre: string): string {
  const inicio = fuente.indexOf(`export async function ${nombre}`);
  assert.ok(inicio > -1, `no se encontró ${nombre}`);
  const fin = fuente.indexOf("\n// ──", inicio + 10);
  return fuente.slice(inicio, fin === -1 ? undefined : fin);
}

const registrar = funcion("registrarOperacionCuentaCorriente");
const resolver = funcion("resolverExcepcionCredito");

// ── Permisos (contrato compartido con el seed y las rutas) ──────────────────

test("los permisos exportados coinciden con los códigos sembrados en el seed", () => {
  assert.match(fuente, /PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE = "ventas:gestionar_cuenta_corriente"/);
  assert.match(fuente, /PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO = "ventas:autorizar_excepcion_credito"/);
  const seed = leer("../../../../prisma/seed.ts");
  assert.match(seed, /"ventas:gestionar_cuenta_corriente"/);
  assert.match(seed, /"ventas:autorizar_excepcion_credito"/);
});

test("cada Route Handler queda gateado por UN único withPermission con su permiso exacto", () => {
  const consulta = leer("../../../app/api/ventas/cuentas-corrientes/[cliente_id]/route.ts");
  const alta = leer("../../../app/api/ventas/cuentas-corrientes/[cliente_id]/operaciones/route.ts");
  const resolverRuta = leer("../../../app/api/ventas/cuentas-corrientes/operaciones/[id]/resolver/route.ts");

  assert.match(consulta, /export const GET = withPermission\(\s*\n\s*PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE/);
  assert.match(alta, /export const POST = withPermission\(\s*\n\s*PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE/);
  // El endpoint de resolución exige el permiso EXCLUSIVO del Supervisor — nunca el del Cajero.
  assert.match(resolverRuta, /export const PATCH = withPermission\(\s*\n\s*PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO/);
  assert.doesNotMatch(resolverRuta, /PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE/);
  for (const ruta of [consulta, alta, resolverRuta]) {
    assert.equal((ruta.match(/withPermission\(\s*\n/g) ?? []).length, 1);
  }
});

test("route.ts y actions.ts no contienen lógica de negocio ni acceso directo a prisma", () => {
  const archivos = [
    "../../../app/api/ventas/cuentas-corrientes/[cliente_id]/route.ts",
    "../../../app/api/ventas/cuentas-corrientes/[cliente_id]/operaciones/route.ts",
    "../../../app/api/ventas/cuentas-corrientes/operaciones/[id]/resolver/route.ts",
    "../../../app/(dashboard)/ventas/cuentas-corrientes/actions.ts",
  ];
  for (const a of archivos) {
    const codigo = leer(a);
    assert.doesNotMatch(codigo, /@\/lib\/db\/prisma/, a);
    assert.doesNotMatch(codigo, /\$transaction/, a);
  }
});

// ── registrarOperacionCuentaCorriente — dentro / fuera de límite ────────────

test("registrar: calcula disponible = límite - saldo DENTRO de la transacción, con la fila bloqueada (FOR UPDATE)", () => {
  const idxTx = registrar.indexOf("prisma.$transaction");
  const idxLock = registrar.indexOf("FOR UPDATE");
  const idxDisponible = registrar.indexOf("const disponible");
  assert.ok(idxTx > -1 && idxLock > idxTx && idxDisponible > idxLock);
  assert.match(registrar, /limite_credito_autorizado\)\.sub\(cuenta\.saldo_actual\)/);
});

test("registrar: monto <= disponible → APROBADA; monto > disponible → RETENIDA (autorizado_por_id null)", () => {
  assert.match(registrar, /const aprobada = monto\.lte\(disponible\)/);
  assert.match(registrar, /estado: aprobada \? "APROBADA" : "RETENIDA"/);
  assert.match(registrar, /autorizado_por_id: null/);
});

test("registrar: el saldo_actual solo se incrementa cuando la operación queda APROBADA", () => {
  const idxIf = registrar.indexOf("if (aprobada) {");
  const idxInc = registrar.indexOf("saldo_actual: { increment: monto }");
  assert.ok(idxIf > -1 && idxInc > idxIf);
  assert.equal((registrar.match(/increment/g) ?? []).length, 1);
});

test("registrar: valida cuenta (404), pedido inexistente (404), pedido de otro cliente (422) y pedido ANULADO/inactivo (422)", () => {
  assert.match(registrar, /"CUENTA_CORRIENTE_NO_ENCONTRADA"/);
  assert.match(registrar, /"PEDIDO_VENTA_NO_ENCONTRADO"/);
  assert.match(registrar, /pedido\.cliente_id !== clienteId/);
  assert.match(registrar, /"PEDIDO_VENTA_NO_CORRESPONDE_AL_CLIENTE"/);
  assert.match(registrar, /!pedido\.is_active \|\| pedido\.estado === "ANULADO"/);
  assert.match(registrar, /"PEDIDO_VENTA_NO_OPERABLE"/);
});

test("registrar: LIMITE_CREDITO_EXCEDIDO se lanza DESPUÉS del COMMIT y del evento, con details.operacion_id", () => {
  const idxTx = registrar.indexOf("await prisma.$transaction");
  const idxEmit = registrar.indexOf('domainEventBus.emit("venta:operacion_cuenta_corriente_registrada"');
  const idxThrow = registrar.indexOf('"LIMITE_CREDITO_EXCEDIDO"');
  assert.ok(idxTx > -1 && idxEmit > idxTx && idxThrow > idxEmit);
  assert.match(registrar, /\{ operacion_id: resultado\.operacionId \}/);
  assert.match(
    registrar,
    /"La operación excede el límite de crédito disponible; requiere autorización de un Supervisor de Ventas"/,
  );
});

test("registrar: el evento se emite para APROBADA y RETENIDA (incondicional respecto de `aprobada`) y nunca dentro de la transacción", () => {
  const idxCierreTx = registrar.indexOf("// Post-COMMIT");
  const idxEmit = registrar.indexOf("domainEventBus.emit(");
  assert.ok(idxCierreTx > -1 && idxEmit > idxCierreTx);
  assert.equal((registrar.match(/domainEventBus\.emit\(/g) ?? []).length, 1);
});

// ── resolverExcepcionCredito — aprobar / rechazar / transición inválida ─────

test("resolver: la guardia de estado origen es un updateMany atómico sobre estado RETENIDA con count === 1", () => {
  assert.match(resolver, /tx\.cuentaCorrienteOperacion\.updateMany/);
  assert.match(resolver, /estado: "RETENIDA"/);
  assert.match(resolver, /count !== 1/);
  assert.match(resolver, /"TRANSICION_INVALIDA"/);
  assert.match(resolver, /"Solo una operación en estado RETENIDA puede resolverse"/);
});

test("resolver: APROBAR → APROBADA + saldo_actual += monto; RECHAZAR → RECHAZADA sin tocar el saldo", () => {
  assert.match(resolver, /estado: aprobar \? "APROBADA" : "RECHAZADA"/);
  assert.match(resolver, /autorizado_por_id: usuarioAutorizanteId/);
  const idxIf = resolver.indexOf("if (aprobar) {");
  const idxInc = resolver.indexOf("saldo_actual: { increment: operacion.monto }");
  assert.ok(idxIf > -1 && idxInc > idxIf);
  assert.equal((resolver.match(/increment/g) ?? []).length, 1);
});

test("resolver: al aprobar NO se revalida el límite de crédito", () => {
  assert.doesNotMatch(resolver, /limite_credito_autorizado/);
});

test("resolver: autorizacion_id = crypto.randomUUID() generado antes de abrir la $transaction", () => {
  const idxRandom = resolver.indexOf("crypto.randomUUID()");
  const idxTx = resolver.indexOf("await prisma.$transaction");
  assert.ok(idxRandom > -1 && idxTx > idxRandom);
});

test("resolver: emite venta:excepcion_credito_resuelta DESPUÉS del COMMIT con el payload completo del task", () => {
  const idxTx = resolver.indexOf("await prisma.$transaction");
  const idxEmit = resolver.indexOf('domainEventBus.emit("venta:excepcion_credito_resuelta"');
  assert.ok(idxTx > -1 && idxEmit > idxTx);
  const bloque = resolver.slice(idxEmit);
  for (const campo of [
    "autorizacion_id",
    "operacion_id",
    "pedido_venta_id",
    "cliente_id",
    "usuario_solicitante_id",
    "usuario_autorizante_id",
    "decision",
    "motivo",
    "monto",
  ]) {
    assert.match(bloque, new RegExp(`${campo}:`), `falta ${campo} en el payload`);
  }
});

test("resolver: usuario_solicitante_id sale de PedidoVenta.registrado_por_id (limitación conocida, sin columna propia)", () => {
  assert.match(resolver, /pedido_venta: \{ select: \{ registrado_por_id: true \} \}/);
  assert.match(resolver, /solicitanteId: operacion\.pedido_venta\.registrado_por_id/);
});

// ── Regla N.° 1 (sin DELETE físico) ─────────────────────────────────────────

test("el servicio no invoca delete() ni deleteMany() (RULES.md Regla N.° 1)", () => {
  assert.doesNotMatch(fuente, /\.delete(Many)?\(/);
});

// ── Eventos y listener ──────────────────────────────────────────────────────

test("los dos eventos están tipados en event-types.ts y el sensible tiene handler en el listener de auditoría", () => {
  const eventos = leer("../../events/event-types.ts");
  assert.match(eventos, /"venta:operacion_cuenta_corriente_registrada": OperacionCuentaCorrienteRegistradaPayload/);
  assert.match(eventos, /"venta:excepcion_credito_resuelta": ExcepcionCreditoResueltaPayload/);

  const listener = leer("../../events/listeners/audit-log.listener.ts");
  const idx = listener.indexOf('domainEventBus.on("venta:excepcion_credito_resuelta"');
  assert.ok(idx > -1);
  const bloque = listener.slice(idx, idx + 1200);
  assert.match(bloque, /usuario_id: payload\.usuario_autorizante_id/);
  assert.match(bloque, /usuario_solicitante_id: payload\.usuario_solicitante_id/);
  assert.match(bloque, /autorizacion_id: payload\.autorizacion_id/);
});
