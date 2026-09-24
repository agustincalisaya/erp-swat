import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AvisoDniCliente,
  BotonAltaCliente,
  dniExistenteActual,
  type DniExistenteAlta,
} from "./ControlesAltaCliente";

function renderAviso(cliente: DniExistenteAlta) {
  return renderToStaticMarkup(createElement(AvisoDniCliente, {
    cliente,
    onIrFicha: () => {},
  }));
}

function renderBoton(bloqueado: boolean) {
  return renderToStaticMarkup(createElement(BotonAltaCliente, {
    enviando: false,
    bloqueado,
    continuar: false,
  }));
}

for (const isActive of [true, false]) {
  test(`DNI existente ${isActive ? "activo" : "inactivo"}: aviso con acceso a ficha y alta bloqueada`, () => {
    const cliente = { dni: "30123456", id: "cliente-1", is_active: isActive };
    const actual = dniExistenteActual(cliente, "30123456");

    assert.deepEqual(actual, cliente);
    const aviso = renderAviso(actual!);
    assert.match(aviso, /Este DNI ya existe/);
    assert.match(aviso, /Ir a la ficha del cliente/);
    assert.doesNotMatch(aviso, /se recuperó el cliente/);
    assert.equal(aviso.includes("cliente inactivo"), !isActive);
    assert.match(renderBoton(!!actual), /<button[^>]*\sdisabled(?:\s|=|>)/);
  });
}

test("al cambiar el DNI, el aviso anterior no bloquea el alta", () => {
  const anterior = { dni: "30123456", id: "cliente-1", is_active: true };
  const actual = dniExistenteActual(anterior, "40123456");

  assert.equal(actual, null);
  assert.doesNotMatch(renderBoton(!!actual), /<button[^>]*\sdisabled(?:\s|=|>)/);
});

test("la respuesta de HU-C1 ante un alta concurrente usa el mismo aviso", () => {
  const recuperado = { dni: "30123456", id: "cliente-1", is_active: null };
  const actual = dniExistenteActual(recuperado, "30123456");

  assert.match(renderAviso(actual!), /Ir a la ficha del cliente/);
  assert.match(renderBoton(!!actual), /<button[^>]*\sdisabled(?:\s|=|>)/);
});

test("si los permisos ocultan la ficha, el aviso se mantiene sin acceso", () => {
  const aviso = renderAviso({ dni: "30123456", id: null, is_active: true });

  assert.match(aviso, /Este DNI ya existe/);
  assert.doesNotMatch(aviso, /Ir a la ficha del cliente/);
});
