import assert from "node:assert/strict";
import test from "node:test";
import { resolverAccionCuentaPorPagar } from "./cuenta-por-pagar.listener.routing.ts";

// HU-G8 §2 / §4.3 — el listener reactivo (`cuenta-por-pagar.listener.ts`)
// discrimina por `payload.accion` del evento `orden_compra:estado_cambiado`,
// NUNCA por `estado_nuevo`. `resolverAccionCuentaPorPagar` es el mapa puro que
// decide qué rama de la máquina de estados de CuentaPorPagar dispara cada
// acción de OrdenCompra, sin tocar Prisma ni el bus (verificable sin DB).

test("resolverAccionCuentaPorPagar: ENVIAR genera la cuenta provisoria (§2.1)", () => {
  assert.equal(resolverAccionCuentaPorPagar("ENVIAR"), "generar");
});

test("resolverAccionCuentaPorPagar: CERRAR consolida la cuenta a definitiva (§2.2)", () => {
  assert.equal(resolverAccionCuentaPorPagar("CERRAR"), "consolidar");
});

test("resolverAccionCuentaPorPagar: CANCELAR cancela la cuenta provisoria (§2.3)", () => {
  assert.equal(resolverAccionCuentaPorPagar("CANCELAR"), "cancelar");
});

test("resolverAccionCuentaPorPagar: CONFIRMAR no tiene efecto sobre Cuentas por Pagar", () => {
  assert.equal(resolverAccionCuentaPorPagar("CONFIRMAR"), "ignorar");
});

test("resolverAccionCuentaPorPagar: una accion desconocida se ignora, nunca lanza", () => {
  assert.equal(resolverAccionCuentaPorPagar("FOO_DESCONOCIDA"), "ignorar");
  assert.equal(resolverAccionCuentaPorPagar(""), "ignorar");
});
