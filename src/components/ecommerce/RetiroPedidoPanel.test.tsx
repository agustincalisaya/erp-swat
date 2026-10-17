import assert from "node:assert/strict";
import path from "node:path";
import test, { before, mock } from "node:test";
import { pathToFileURL } from "node:url";
import * as React from "react";
import type { ReactElement } from "react";

import { mensajeErrorRetiro } from "./pick-pack-client";
import type { RespuestaApi, ResultadoRetiroJson } from "./pick-pack-client";

type Slot = { valor: unknown };
type Nodo = ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

let slots: Slot[] = [];
let indice = 0;
let solicitudes: Array<{ qr_token: string; dni: string }> = [];
let responder: ((respuesta: RespuestaApi<ResultadoRetiroJson>) => void) | undefined;

function useStateSimulado<T>(inicial: T | (() => T)) {
  const posicion = indice++;
  slots[posicion] ??= { valor: typeof inicial === "function" ? (inicial as () => T)() : inicial };
  const setValor = (siguiente: T | ((actual: T) => T)) => {
    const actual = slots[posicion].valor as T;
    slots[posicion].valor = typeof siguiente === "function"
      ? (siguiente as (valor: T) => T)(actual)
      : siguiente;
  };
  return [slots[posicion].valor as T, setValor] as const;
}

function useRefSimulado<T>(inicial: T) {
  const posicion = indice++;
  slots[posicion] ??= { valor: { current: inicial } };
  return slots[posicion].valor as { current: T };
}

// Sin DOM de test instalado: se ejecutan los callbacks reales y se vuelve a
// renderizar el árbol del componente tras cada interacción.
mock.module("react", {
  namedExports: { ...React, useState: useStateSimulado, useRef: useRefSimulado },
  defaultExport: { ...React, useState: useStateSimulado, useRef: useRefSimulado },
});
mock.module(pathToFileURL(path.resolve("src/components/ecommerce/pick-pack-client.ts")).href, {
  namedExports: {
    mensajeErrorRetiro,
    validarRetiroApi: (qr_token: string, dni: string) => {
      solicitudes.push({ qr_token, dni });
      return new Promise<RespuestaApi<ResultadoRetiroJson>>((resolve) => { responder = resolve; });
    },
  },
});

let RetiroPedidoPanel: typeof import("./RetiroPedidoPanel").RetiroPedidoPanel;
before(async () => {
  ({ RetiroPedidoPanel } = await import("./RetiroPedidoPanel"));
});

function reiniciar() {
  slots = [];
  indice = 0;
  solicitudes = [];
  responder = undefined;
}

function renderizar(): Nodo {
  indice = 0;
  return RetiroPedidoPanel() as Nodo;
}

function nodos(raiz: unknown): Nodo[] {
  if (Array.isArray(raiz)) return raiz.flatMap(nodos);
  if (!React.isValidElement(raiz)) return [];
  const nodo = raiz as Nodo;
  return [nodo, ...nodos(nodo.props.children)];
}

function buscar(raiz: Nodo, predicado: (nodo: Nodo) => boolean): Nodo {
  const nodo = nodos(raiz).find(predicado);
  assert.ok(nodo, "El control esperado debe estar en el árbol del panel");
  return nodo;
}

function input(raiz: Nodo, id: string): Nodo {
  return buscar(raiz, (nodo) => nodo.props.id === id);
}

function texto(raiz: unknown): string {
  if (Array.isArray(raiz)) return raiz.map(texto).join(" ");
  if (typeof raiz === "string" || typeof raiz === "number") return String(raiz);
  if (!React.isValidElement(raiz)) return "";
  return texto((raiz as Nodo).props.children);
}

function boton(raiz: Nodo, nombre: string): Nodo {
  return buscar(raiz, (nodo) =>
    (nombre === "entregar" && nodo.props.type === "submit")
    || (nodo.props.type === "button" && texto(nodo).includes(nombre)));
}

function escribir(raiz: Nodo, id: string, valor: string) {
  (input(raiz, id).props.onChange as (evento: { target: { value: string } }) => void)(
    { target: { value: valor } },
  );
}

function enviar(raiz: Nodo) {
  (buscar(raiz, (nodo) => nodo.type === "form").props.onSubmit as
    (evento: { preventDefault: () => void }) => void)({ preventDefault() {} });
}

async function completar(status: number, numero = "V-2026-000099") {
  const resolver = responder;
  assert.ok(resolver, "Debe existir una solicitud pendiente");
  resolver({
    ok: status === 200,
    status,
    data: status === 200 ? { pedido_venta_id: "pv-1", numero, estado: "ENTREGADO" } : null,
    error: status === 200 ? null : { code: "MOTIVO_INTERNO", message: "dato privado" },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("retiro: flujo manual, payload exacto, doble submit bloqueado y limpieza tras éxito", async () => {
  reiniciar();
  let vista = renderizar();
  assert.equal(input(vista, "retiro-qr").props.type, "password");
  assert.equal(input(vista, "retiro-dni").props.type, "password");
  assert.equal(boton(vista, "entregar").props.disabled, true);

  escribir(vista, "retiro-qr", "  token-manual  ");
  vista = renderizar();
  escribir(vista, "retiro-dni", " 12345678 ");
  vista = renderizar();
  assert.equal(boton(vista, "entregar").props.disabled, false);
  enviar(vista);
  enviar(vista);
  vista = renderizar();
  assert.deepEqual(solicitudes, [{ qr_token: "token-manual", dni: "12345678" }]);
  assert.equal(boton(vista, "entregar").props.disabled, true);
  assert.match(texto(vista), /Validando retiro/);

  await completar(200);
  vista = renderizar();
  assert.equal(input(vista, "retiro-qr").props.value, "");
  assert.equal(input(vista, "retiro-dni").props.value, "");
  assert.equal(boton(vista, "entregar").props.disabled, true);
  assert.match(texto(vista), /Pedido\s+V-2026-000099\s+entregado correctamente/);
  assert.doesNotMatch(texto(vista), /token-manual|12345678|pv-1/);
});

test("retiro: callback del scanner usa el contenido completo y cierra la cámara", async () => {
  reiniciar();
  let vista = renderizar();
  (boton(vista, "Escanear QR").props.onClick as () => void)();
  vista = renderizar();
  const esScanner = (nodo: Nodo) =>
    typeof nodo.type === "function" && nodo.type.name === "CameraBarcodeScanner";
  const scanner = buscar(vista, esScanner);
  assert.equal(scanner.props.activo, true);
  (scanner.props.onDetect as (contenido: string) => void)("qr:contenido/decodificado");
  vista = renderizar();
  assert.equal(input(vista, "retiro-qr").props.value, "qr:contenido/decodificado");
  assert.ok(!nodos(vista).some(esScanner));
  escribir(vista, "retiro-dni", "7654321");
  vista = renderizar();
  enviar(vista);
  assert.deepEqual(solicitudes, [{ qr_token: "qr:contenido/decodificado", dni: "7654321" }]);
  await completar(200);
  vista = renderizar();
  assert.equal(input(vista, "retiro-qr").props.value, "");
  assert.equal(input(vista, "retiro-dni").props.value, "");
});

for (const status of [422, 401, 403, 500]) {
  test(`retiro: HTTP ${status} muestra solo el mensaje público previsto`, async () => {
    reiniciar();
    let vista = renderizar();
    escribir(vista, "retiro-qr", "token-privado");
    vista = renderizar();
    escribir(vista, "retiro-dni", "12345678");
    vista = renderizar();
    enviar(vista);
    await completar(status);
    vista = renderizar();
    assert.ok(texto(vista).includes(mensajeErrorRetiro(status)));
    assert.doesNotMatch(texto(vista), /MOTIVO_INTERNO|dato privado|token-privado|12345678/);
    assert.equal(input(vista, "retiro-qr").props.value, "token-privado");
    assert.equal(input(vista, "retiro-dni").props.value, "12345678");
  });
}
