import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de la regla estructural de direcciones (HU-C3,
 * spec_modulo_C.md §2.3). Corren bajo el script `test` principal
 * (`node --experimental-strip-types --test`), por eso el import es relativo
 * con extensión explícita — es justamente el motivo por el que la regla vive
 * en un módulo alias-free en vez de dentro de `cliente.service.ts`
 * (Deviation D1).
 */
import { validarReglaDireccionEnvio } from "./direccion-cliente.reglas.ts";

interface ConCodigo {
  code?: string;
}

function capturarError(fn: () => void): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

test("validarReglaDireccionEnvio: ENVIO sin FACTURACION activa lanza DIRECCION_FACTURACION_REQUERIDA", () => {
  const err = capturarError(() => validarReglaDireccionEnvio("ENVIO", false));
  assert.notEqual(err, null, "debería haber lanzado");
  assert.equal((err as ConCodigo).code, "DIRECCION_FACTURACION_REQUERIDA");
  assert.ok(err instanceof Error);
  assert.match(
    (err as Error).message,
    /FACTURACION/,
    "el mensaje debe nombrar el tipo FACTURACION",
  );
});

test("validarReglaDireccionEnvio: ENVIO con FACTURACION activa existente no lanza", () => {
  assert.doesNotThrow(() => validarReglaDireccionEnvio("ENVIO", true));
});

test("validarReglaDireccionEnvio: FACTURACION nunca depende del conteo previo (permite la primera dirección)", () => {
  assert.doesNotThrow(() => validarReglaDireccionEnvio("FACTURACION", false));
  assert.doesNotThrow(() => validarReglaDireccionEnvio("FACTURACION", true));
});
