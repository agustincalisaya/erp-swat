import assert from "node:assert/strict";
import test from "node:test";
import { resolverClienteCreadoEnRegistro } from "./registro-cuenta-web.reglas.ts";

test("H1 — un Cliente aparecido durante crearClienteTx queda pendiente", () => {
  const creado = { esNuevo: false, cliente: { id: "cliente-concurrente" } };
  const resultado = resolverClienteCreadoEnRegistro(creado, { is_active: true, deleted_at: null });

  assert.deepEqual(resultado, {
    disponible: true,
    clienteId: "cliente-concurrente",
    pendiente: true,
  });
});
