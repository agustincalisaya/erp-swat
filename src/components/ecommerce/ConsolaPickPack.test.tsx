import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SelectorOperacion, TarjetaPedidoCola } from "./ConsolaPickPack";
import { ProgresoBarra } from "./ProgresoBarra";
import { BotonCompletar, LineaPreparacionVista, PreparacionPedidoPanel } from "./PreparacionPedidoPanel";
import type { ItemColaPreparacionJson, LineaPreparacionJson } from "./pick-pack-client";

const fuenteConsola = readFileSync(new URL("./ConsolaPickPack.tsx", import.meta.url), "utf8");

const lineaBase: LineaPreparacionJson = {
  pedido_venta_item_id: "li-1",
  variante: { variante_sku_id: "v-1", sku: "CAMTAC-M-XL", producto_nombre: "Campera Táctica" },
  cantidad_requerida: 3,
  cantidad_confirmada: 1,
  completa: false,
};

const pedidoBase: ItemColaPreparacionJson = {
  pedido_venta_id: "pv-1",
  pedido_venta_ecommerce_id: "pve-1",
  numero_venta: "V-2026-000099",
  fecha_pago_confirmado: "2026-10-02T10:00:00.000Z",
  prioridad_manual: 5,
  estado_ecommerce: "PAGO_CONFIRMADO",
  operador_asignado_id: null,
  lineas: [lineaBase],
  progreso: { total_requerido: 3, total_confirmado: 1, porcentaje: 33, completo: false },
};

test("retiro: selector visible solo con permiso granular", () => {
  const oculto = renderToStaticMarkup(createElement(SelectorOperacion, {
    seccion: "preparacion", puedeValidarRetiro: false, onCambiar: () => {},
  }));
  const visible = renderToStaticMarkup(createElement(SelectorOperacion, {
    seccion: "preparacion", puedeValidarRetiro: true, onCambiar: () => {},
  }));
  assert.equal(oculto, "");
  assert.match(visible, />Retiro</);
  assert.match(visible, />Preparación</);
});

function renderTarjeta(overrides: Partial<Parameters<typeof TarjetaPedidoCola>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(TarjetaPedidoCola, {
      pedido: pedidoBase,
      puedePriorizar: false,
      puedePreparar: false,
      esPropio: false,
      accionEnCurso: false,
      onTomar: () => {},
      onPreparar: () => {},
      onPrioridad: () => {},
      ...overrides,
    }),
  );
}

// ── Cola ─────────────────────────────────────────────────────────────────────

test("cola: la tarjeta muestra número de venta, prioridad y progreso del DTO", () => {
  const html = renderTarjeta();
  assert.match(html, /V-2026-000099/);
  assert.match(html, /Prioridad 5/);
  assert.match(html, /1 de 3 unidades/);
  assert.match(html, /33%/);
});

test("cola: registro legacy sin fecha de pago muestra texto dedicado", () => {
  const html = renderTarjeta({
    pedido: { ...pedidoBase, fecha_pago_confirmado: null },
  });
  assert.match(html, /Fecha de pago no disponible \(registro anterior\)/);
});

test("cola: prioridad null no renderiza badge de prioridad", () => {
  const html = renderTarjeta({ pedido: { ...pedidoBase, prioridad_manual: null } });
  assert.doesNotMatch(html, /Prioridad \d/);
});

// ── RBAC/UI ──────────────────────────────────────────────────────────────────

test("RBAC: Admin conserva prioridad para legacy EN_PREPARACION sin operador y no ve 'Tomar pedido'", () => {
  const html = renderTarjeta({
    puedePriorizar: true,
    pedido: { ...pedidoBase, estado_ecommerce: "EN_PREPARACION" },
  });
  assert.match(html, /Prioridad \(1–100\)/);
  assert.doesNotMatch(html, /Tomar pedido/);
  assert.doesNotMatch(html, /Continuar preparación/);
});

test("cola T16: PAGO_CONFIRMADO se muestra pendiente, libre y disponible para tomar", () => {
  const html = renderTarjeta({ puedePreparar: true });
  assert.match(html, /Pendiente de toma/);
  assert.match(html, /Disponible para tomar · Sin operador asignado/);
  assert.match(html, /Tomar pedido/);
  assert.doesNotMatch(html, /En preparación|Continuar preparación/);
  assert.doesNotMatch(html, /Prioridad \(1–100\)/);
});

test("RBAC: pedido tomado por el propio operador ofrece 'Continuar preparación'", () => {
  const html = renderTarjeta({
    puedePreparar: true,
    esPropio: true,
    pedido: { ...pedidoBase, estado_ecommerce: "EN_PREPARACION", operador_asignado_id: "yo-1" },
  });
  assert.match(html, /En preparación/);
  assert.match(html, /Asignado a vos/);
  assert.match(html, /Continuar preparación/);
  assert.doesNotMatch(html, /Tomar pedido/);
});

test("RBAC: pedido tomado por otro operador no ofrece acciones", () => {
  const html = renderTarjeta({
    puedePreparar: true,
    pedido: { ...pedidoBase, estado_ecommerce: "EN_PREPARACION", operador_asignado_id: "otro-1" },
  });
  assert.match(html, /En preparación/);
  assert.match(html, /Asignado a otro operador/);
  assert.doesNotMatch(html, /Tomar pedido/);
  assert.doesNotMatch(html, /Continuar preparación/);
});

test("toma T16 bloquea doble submit, confirma EN_PREPARACION y refresca conflictos", () => {
  assert.match(fuenteConsola, /if \(accionEnCursoRef\.current\) return/);
  assert.match(fuenteConsola, /accionEnCursoRef\.current = pedido\.pedido_venta_id/);
  assert.match(fuenteConsola, /estado_ecommerce: "EN_PREPARACION"/);
  assert.match(fuenteConsola, /if \(r\.status === 409 \|\| r\.status === 404\) refrescar\(\)/);
  assert.match(fuenteConsola, /refrescar\(\);[\s\S]*setPedidoActivo/);
});

test("RBAC: Admin no reprioriza un pedido ya tomado", () => {
  const html = renderTarjeta({
    puedePriorizar: true,
    pedido: { ...pedidoBase, estado_ecommerce: "EN_PREPARACION", operador_asignado_id: "otro-1" },
  });
  assert.doesNotMatch(html, /Prioridad \(1–100\)/);
});

// ── Progreso / líneas ─────────────────────────────────────────────────────────

test("progreso: la barra expone el porcentaje backend vía ARIA", () => {
  const html = renderToStaticMarkup(createElement(ProgresoBarra, { porcentaje: 33 }));
  assert.match(html, /aria-valuenow="33"/);
});

test("línea: incompleta muestra faltantes; completa muestra sello", () => {
  const incompleta = renderToStaticMarkup(createElement(LineaPreparacionVista, { linea: lineaBase }));
  assert.match(incompleta, /Faltan 2/);
  assert.match(incompleta, /Campera Táctica/);
  assert.match(incompleta, /CAMTAC-M-XL/);

  const completa = renderToStaticMarkup(
    createElement(LineaPreparacionVista, {
      linea: { ...lineaBase, cantidad_confirmada: 3, completa: true },
    }),
  );
  assert.match(completa, /Completa/);
  assert.doesNotMatch(completa, /Faltan/);
});

// ── Completar ─────────────────────────────────────────────────────────────────

test("T16: PAGO_CONFIRMADO no expone escaneo ni completar antes de tomar", () => {
  const html = renderToStaticMarkup(createElement(PreparacionPedidoPanel, {
    pedido: pedidoBase,
    onScanAcreditado: () => {},
    onCerrar: () => {},
  }));
  assert.match(html, /todavía no está en preparación/);
  assert.match(html, /Tomá el pedido desde la cola/);
  assert.doesNotMatch(html, /Escaneo de unidades|Completar preparación \(faltan unidades\)/);
});

test("completar: deshabilitado con progreso incompleto, habilitado al 100%", () => {
  const incompleto = renderToStaticMarkup(
    createElement(BotonCompletar, { completo: false, enviando: false, onCompletar: () => {} }),
  );
  assert.match(incompleto, /<button[^>]*\sdisabled(?:\s|=|>)/);
  assert.match(incompleto, /faltan unidades/);

  const completo = renderToStaticMarkup(
    createElement(BotonCompletar, { completo: true, enviando: false, onCompletar: () => {} }),
  );
  assert.doesNotMatch(completo, /<button[^>]*\sdisabled(?:\s|=|>)/);
  assert.match(completo, />Completar preparación</);
});

// ── Seguridad de payload en el render ─────────────────────────────────────────

test("seguridad: el markup de cola y líneas no expone campos sensibles", () => {
  const html = renderTarjeta() +
    renderToStaticMarkup(createElement(LineaPreparacionVista, { linea: lineaBase }));
  for (const campo of [
    "codigo_qr_retiro",
    "mercadopago_payment_id",
    "mercadopago_preference_id",
    "mercadopago_checkout_url",
    "codigo_escaneado",
    "dni",
    "email",
  ]) {
    assert.ok(!html.includes(campo), `El render no debe incluir ${campo}`);
  }
});
