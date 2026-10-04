import assert from "node:assert/strict";
import test from "node:test";

import {
  aplicarResultadoScan,
  cantidadPendiente,
  describirLinea,
  ejecutarEscaneo,
  formatearEstadoEcommerce,
  formatearFechaPagoConfirmado,
  formatearPlazoRetiro,
  mensajeErrorPickPack,
  TEXTO_FECHA_PAGO_LEGACY,
  type ItemColaPreparacionJson,
  type ResultadoConfirmarJson,
} from "./pick-pack-client";

function respuestaJson(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const progresoBase = { total_requerido: 2, total_confirmado: 0, porcentaje: 0, completo: false };

const pedidoBase: ItemColaPreparacionJson = {
  pedido_venta_id: "pv-1",
  pedido_venta_ecommerce_id: "pve-1",
  numero_venta: "V-2026-000099",
  fecha_pago_confirmado: "2026-10-02T10:00:00.000Z",
  prioridad_manual: null,
  estado_ecommerce: "EN_PREPARACION",
  operador_asignado_id: null,
  lineas: [
    {
      pedido_venta_item_id: "li-1",
      variante: { variante_sku_id: "v-1", sku: "SKU-1", producto_nombre: "Remera", talle: "M" },
      cantidad_requerida: 2,
      cantidad_confirmada: 0,
      completa: false,
    },
  ],
  progreso: progresoBase,
};

// ── scan_id: generación y reuse en retry técnico ──────────────────────────────

test("scan: cada lectura física genera un scan_id nuevo", async () => {
  const cuerpos: Array<{ scan_id: string }> = [];
  const fetchFn = async (_url: string, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)));
    return respuestaJson(200, { data: {}, error: null });
  };
  let n = 0;
  const generarUuid = () => `uuid-${++n}`;

  await ejecutarEscaneo("pv-1", "SKU-1", { fetchFn, generarUuid });
  await ejecutarEscaneo("pv-1", "SKU-1", { fetchFn, generarUuid });

  assert.equal(cuerpos[0].scan_id, "uuid-1");
  assert.equal(cuerpos[1].scan_id, "uuid-2");
});

test("scan: retry técnico por fallo de red reutiliza el MISMO scan_id", async () => {
  const cuerpos: Array<{ scan_id: string }> = [];
  let intentos = 0;
  const fetchFn = async (_url: string, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)));
    intentos++;
    if (intentos === 1) throw new Error("network down");
    return respuestaJson(200, { data: {}, error: null });
  };

  const r = await ejecutarEscaneo("pv-1", "SKU-1", {
    fetchFn,
    generarUuid: () => "uuid-fijo",
  });

  assert.equal(r.ok, true);
  assert.equal(intentos, 2);
  assert.equal(cuerpos[0].scan_id, "uuid-fijo");
  assert.equal(cuerpos[1].scan_id, "uuid-fijo");
});

test("scan: un 409 NO reintenta — el conflicto es de dominio, no de red", async () => {
  let intentos = 0;
  const fetchFn = async () => {
    intentos++;
    return respuestaJson(409, {
      data: null,
      error: { code: "CANTIDAD_YA_COMPLETA", message: "x" },
    });
  };

  const r = await ejecutarEscaneo("pv-1", "SKU-1", { fetchFn, generarUuid: () => "u" });

  assert.equal(intentos, 1);
  assert.equal(r.status, 409);
  assert.equal(r.error?.code, "CANTIDAD_YA_COMPLETA");
});

test("scan: agotados los reintentos de red reporta errorRed sin status HTTP", async () => {
  const fetchFn = async () => {
    throw new Error("offline");
  };
  const r = await ejecutarEscaneo("pv-1", "SKU-1", { fetchFn, reintentos: 1 });
  assert.equal(r.errorRed, true);
  assert.equal(r.status, 0);
});

// ── aplicarResultadoScan: progreso del backend como source of truth ────────────

test("scan: el resultado acredita la línea y reemplaza el progreso con el del backend", () => {
  const resultado: ResultadoConfirmarJson = {
    pedido_venta_item_id: "li-1",
    variante_sku_id: "v-1",
    scan_id: "s-1",
    cantidad_confirmada: 1,
    progreso: { total_requerido: 2, total_confirmado: 1, porcentaje: 50, completo: false },
    idempotente: false,
    cambio_realizado: true,
  };
  const actualizado = aplicarResultadoScan(pedidoBase, resultado);
  assert.equal(actualizado.lineas[0].cantidad_confirmada, 1);
  assert.equal(actualizado.lineas[0].completa, false);
  assert.deepEqual(actualizado.progreso, resultado.progreso);
});

test("scan: completar la línea la marca completa", () => {
  const resultado: ResultadoConfirmarJson = {
    pedido_venta_item_id: "li-1",
    variante_sku_id: "v-1",
    scan_id: "s-2",
    cantidad_confirmada: 2,
    progreso: { total_requerido: 2, total_confirmado: 2, porcentaje: 100, completo: true },
    idempotente: false,
    cambio_realizado: true,
  };
  const actualizado = aplicarResultadoScan(pedidoBase, resultado);
  assert.equal(actualizado.lineas[0].completa, true);
  assert.equal(actualizado.progreso.completo, true);
});

// ── mensajes de error seguros ─────────────────────────────────────────────────

test("errores: mapeo contractual de status y códigos 409", () => {
  assert.equal(mensajeErrorPickPack(400), "Los datos enviados no son válidos.");
  assert.equal(mensajeErrorPickPack(401), "Tu sesión expiró. Volvé a iniciar sesión.");
  assert.equal(mensajeErrorPickPack(403), "No tenés permisos para esta operación.");
  assert.equal(mensajeErrorPickPack(404), "El pedido ya no está disponible.");
  assert.equal(mensajeErrorPickPack(500), "Error interno. Intentá nuevamente.");
  assert.equal(
    mensajeErrorPickPack(409, "CODIGO_NO_PERTENECE_PEDIDO"),
    "El producto escaneado no pertenece a este pedido.",
  );
  assert.equal(
    mensajeErrorPickPack(409, "CANTIDAD_YA_COMPLETA"),
    "La cantidad requerida de este producto ya fue completada.",
  );
});

test("errores: SCAN_ID_CONFLICTO es genérico y no revela pedido/actor previo", () => {
  const mensaje = mensajeErrorPickPack(409, "SCAN_ID_CONFLICTO");
  assert.equal(mensaje, "Conflicto de escaneo. Reintentá la lectura.");
  assert.doesNotMatch(mensaje, /pedido|operador|scan_id/i);
});

// ── formateo ──────────────────────────────────────────────────────────────────

test("fecha legacy: null muestra texto de registro anterior sin inventar fecha", () => {
  assert.equal(formatearFechaPagoConfirmado(null), TEXTO_FECHA_PAGO_LEGACY);
  assert.equal(formatearFechaPagoConfirmado("no-es-fecha"), TEXTO_FECHA_PAGO_LEGACY);
  const conFecha = formatearFechaPagoConfirmado("2026-10-02T10:00:00.000Z");
  assert.notEqual(conFecha, TEXTO_FECHA_PAGO_LEGACY);
  assert.match(conFecha, /10\/26|2026/);
});

test("formato: estado, plazo, pendiente y descripción de línea", () => {
  assert.equal(formatearEstadoEcommerce("EN_PREPARACION"), "En preparación");
  assert.equal(formatearEstadoEcommerce("LISTO_PARA_RETIRO"), "Listo para retiro");
  assert.equal(formatearPlazoRetiro(null), null);
  assert.ok(formatearPlazoRetiro("2026-10-10T13:00:00.000Z")!.includes("2026"));

  const linea = pedidoBase.lineas[0];
  assert.equal(cantidadPendiente(linea), 2);
  assert.equal(cantidadPendiente({ ...linea, cantidad_confirmada: 5 }), 0);
  assert.equal(describirLinea(linea), "Remera (M)");
  assert.equal(describirLinea({ ...linea, variante: { ...linea.variante, talle: null } }), "Remera");
});
