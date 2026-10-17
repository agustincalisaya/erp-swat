import assert from "node:assert/strict";
import test from "node:test";
import { textoMotivoBajaCupon } from "./motivo-baja-cupon.ts";

test("textoMotivoBajaCupon traduce los códigos automáticos", () => {
  assert.equal(textoMotivoBajaCupon("VENCIMIENTO"), "Vencimiento");
  assert.equal(textoMotivoBajaCupon("LIMITE_GLOBAL_AGOTADO"), "Límite de uso agotado");
  assert.equal(textoMotivoBajaCupon("TTL_CHECKOUT_VENCIDO"), "Reserva vencida");
});

test("textoMotivoBajaCupon deja intacto el motivo manual", () => {
  assert.equal(textoMotivoBajaCupon("Fin de la campaña de otoño"), "Fin de la campaña de otoño");
  assert.equal(textoMotivoBajaCupon("vencimiento"), "vencimiento");
  assert.equal(textoMotivoBajaCupon("toString"), "toString");
});
