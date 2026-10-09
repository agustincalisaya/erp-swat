import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fuente = readFileSync(new URL("./CancelarPedidoWeb.tsx", import.meta.url), "utf8");

test("modal accesible valida motivo y bloquea doble submit", () => {
  assert.match(fuente, /<Dialog open=\{abierto\}/);
  assert.match(fuente, /<Label htmlFor=\{`motivo-cancelacion-/);
  assert.match(fuente, /motivo\.trim\(\)\.length > 0/);
  assert.match(fuente, /required/);
  assert.match(fuente, /enviandoRef\.current/);
  assert.match(fuente, /disabled=\{!motivoValido \|\| enviando\}/);
  assert.match(fuente, /Cancelando…/);
  assert.match(fuente, /flex flex-col-reverse gap-2 sm:flex-row/);
});

test("acción, éxito y carrera usan estados y mensajes comerciales seguros", () => {
  assert.match(fuente, /estado === "PAGO_CONFIRMADO"/);
  assert.match(fuente, /Pedido cancelado correctamente\. Se inició el proceso de reintegro\./);
  assert.match(fuente, /resultado\.status === 409/);
  assert.match(fuente, /window\.location\.reload\(\)/);
  assert.doesNotMatch(fuente, /dinero devuelto|reembolso completado|Mercado Pago aprobó/i);
});

test("componente no usa identidades ni datos técnicos HU-E13", () => {
  for (const prohibido of ["cliente_id", "cliente_web_cuenta_id", "usuario_id", "actor_id", "reintegro_id", "intento_id", "refund_id", "mercadopago_payment_id", "clave_idempotencia", "localStorage", "sessionStorage"]) {
    assert.ok(!fuente.includes(prohibido), `No debe contener ${prohibido}`);
  }
});
