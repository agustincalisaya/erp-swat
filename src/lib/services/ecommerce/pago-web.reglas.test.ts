/**
 * HU-E2 — reglas puras del pago web (CA3, CA5, P13, Q2, D-E2-5). Unit, sin DB.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { Prisma } from "@prisma/client";
import {
  clasificarAprobadoSobreResuelto,
  esReferenciaValida,
  pagoCoincideConPedido,
  reservasVigentesParaConfirmar,
} from "./pago-web.reglas.ts";

test("external_reference: solo UUID", () => {
  assert.equal(esReferenciaValida("385f3f34-2984-4b69-aa63-c61458c3cc9e"), true);
  assert.equal(esReferenciaValida(null), false);
  assert.equal(esReferenciaValida(""), false);
  assert.equal(esReferenciaValida("pedido-123"), false);
});

test("monto: coincide al centavo y en ARS (P13)", () => {
  assert.equal(pagoCoincideConPedido("15210.00", 15210, "ARS"), true);
  assert.equal(pagoCoincideConPedido("15210.10", 15210.1, "ARS"), true);
  assert.equal(pagoCoincideConPedido("15210.00", 15209.99, "ARS"), false);
  assert.equal(pagoCoincideConPedido("15210.00", 15210, "USD"), false);
  assert.equal(pagoCoincideConPedido("0.30", 0.1 + 0.2, "ARS"), true);
});

test("reservas: todas abiertas y sin vencer (Q2)", () => {
  const ahora = new Date("2026-10-01T15:00:00Z");
  const futura = { fecha_expiracion: new Date("2026-10-01T16:00:00Z"), fecha_fin_reserva: null };
  const vencida = { fecha_expiracion: new Date("2026-10-01T14:59:59Z"), fecha_fin_reserva: null };
  const cerrada = { fecha_expiracion: new Date("2026-10-01T16:00:00Z"), fecha_fin_reserva: ahora };
  assert.equal(reservasVigentesParaConfirmar([futura, futura], ahora), true);
  assert.equal(reservasVigentesParaConfirmar([futura, vencida], ahora), false);
  assert.equal(reservasVigentesParaConfirmar([cerrada], ahora), false);
  assert.equal(reservasVigentesParaConfirmar([null], ahora), false);
  assert.equal(reservasVigentesParaConfirmar([], ahora), false);
});

test("aprobado sobre pedido ya resuelto (CA3, D-E2-5, Q2)", () => {
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_CONFIRMADO", "111", "111"), "SIN_EFECTO");
  assert.equal(clasificarAprobadoSobreResuelto("EN_PREPARACION", "111", "111"), "SIN_EFECTO");
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_CONFIRMADO", "111", "222"), "PAGO_DUPLICADO");
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_RECHAZADO", "111", "222"), "PAGO_TARDIO");
  assert.equal(clasificarAprobadoSobreResuelto("PAGO_RECHAZADO", "111", "111"), "PAGO_TARDIO");
  assert.equal(clasificarAprobadoSobreResuelto("ANULADO", null, "222"), "PAGO_TARDIO");
});

/**
 * Carga los servicios reales con dependencias aisladas, siguiendo el patrón
 * de lectura de fuente de los unitarios de servicios server-only. La tx se
 * sustituye por su resultado: solo prueba el procesamiento POST-commit, no
 * persistencia, admisión, stock, factura ni listeners de producción.
 */
function escenarioPostCommit(estado: "APROBADO" | "RECHAZADO", excedido = false) {
  const bus = new EventEmitter();
  const orden: string[] = [];
  const logs: unknown[][] = [];
  const consumo = {
    cupon_id: "cupon-test", aplicacion_id: "aplicacion-test",
    pedido_venta_id: "venta-test", ocurrido_en: new Date("2026-10-03T12:00:00Z"),
  };
  const venta = { id: "venta-test", numero_venta: "WEB-TEST", cliente_id: "cliente-test" };
  const resultadoTx = estado === "APROBADO" ? {
    venta, total: new Prisma.Decimal(9000), comprobanteId: "factura-test",
    cuponAplicacionId: consumo.aplicacion_id, cuponExcedido: excedido,
    cuponConsumo: consumo, cuentaId: "cuenta-test", eventosReserva: [],
    eventoAdmision: { tipo: "ecommerce:pedido_admitido_cola", payload: { evento_id: "admision-test" } },
    transaccionId: "transaccion-test",
  } : {
    venta, cuentaId: "cuenta-test", carritoId: "carrito-test", liberadas: [],
    preferenceId: "preferencia-test", cuponLiberado: { ...consumo, motivo: "Pago rechazado por Mercado Pago" },
    transaccionId: "transaccion-test",
  };
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@prisma/client": { Prisma },
    "@/lib/crypto/aes": { encrypt: () => ({ ciphertext: "ciphertext-test", iv: "iv-test" }) },
    "@/lib/db/prisma": { prisma: {
      pedidoVentaEcommerce: { findUnique: async () => ({ id: "ecommerce-test", pedido_venta_id: venta.id }) },
      $transaction: async () => { orden.push("commit-simulado"); return resultadoTx; },
    } },
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/errors/service-error": {},
    "@/lib/integraciones/mercadopago/adapter": {},
    "@/lib/services/ecommerce/carrito.service": {},
    "@/lib/services/ecommerce/pick-pack.service": {},
    "@/lib/services/ecommerce/pago-web.reglas": {
      esReferenciaValida: () => true, MONEDA_CANAL_WEB: "ARS",
    },
    "@/lib/services/ecommerce/usuario-canal-web": { obtenerUsuarioCanalWebId: async () => "canal-web-test" },
    "@/lib/services/inventario/reserva.service": { emitirReservasLiberadas: () => orden.push("stock") },
    "@/lib/services/ventas/comprobante-fiscal.service": {},
    "@/lib/services/ventas/pedido-venta.service": {},
  };
  function cargar(ruta: string): Record<string, unknown> {
    const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
    const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
    const modulo = { exports: {} };
    const ejecutar = runInThisContext(`(function(require, module, exports, console) {\n${codigo}\n})`, { filename: ruta });
    ejecutar((nombre: string) => {
      assert.ok(Object.hasOwn(dependencias, nombre), `Dependencia inesperada: ${nombre}`);
      return dependencias[nombre];
    }, modulo, modulo.exports, { error: (...args: unknown[]) => logs.push(args) });
    return modulo.exports;
  }
  dependencias["@/lib/services/ecommerce/cupon.service"] = cargar("./cupon.service.ts");
  const servicio = cargar("./pago-web.service.ts") as {
    procesarNotificacionPago: (id: string, pasarela: unknown) => Promise<{ resultado: string; pedido_venta_id: string }>;
  };
  for (const evento of [
    "ecommerce:pedido_pago_confirmado", "ecommerce:cupon_consumido",
    "ecommerce:pedido_admitido_cola", "ecommerce:pago_anomalo",
    "ecommerce:pago_rechazado", "ecommerce:cupon_aplicacion_liberada",
  ]) bus.on(evento, () => orden.push(evento));
  return {
    bus, orden, logs,
    procesar: () => servicio.procesarNotificacionPago("pago-test", {
      consultarPago: async () => ({
        payment_id: "pago-test", estado, status_mp: estado === "APROBADO" ? "approved" : "rejected",
        external_reference: "ecommerce-test", monto: 9000, moneda: "ARS",
      }),
      cerrarCobro: async () => { orden.push("cerrarCobro"); },
    }),
  };
}

test("post-commit: consumo que lanza se registra y permite admisión y anomalía posteriores", async () => {
  const s = escenarioPostCommit("APROBADO", true);
  s.bus.on("ecommerce:cupon_consumido", () => { throw new Error("fallo controlado consumo"); });
  assert.deepEqual(await s.procesar(), { resultado: "CONFIRMADO", pedido_venta_id: "venta-test" });
  assert.deepEqual(s.orden, ["commit-simulado", "stock", "ecommerce:pedido_pago_confirmado",
    "ecommerce:cupon_consumido", "ecommerce:pedido_admitido_cola", "ecommerce:pago_anomalo"]);
  assert.equal(s.logs.length, 1);
  assert.match(String(s.logs[0][0]), /post-commit.*ecommerce:cupon_consumido/);
  assert.deepEqual(s.logs[0][1], {
    pedido_venta_id: "venta-test", mercadopago_payment_id: "pago-test", error: "fallo controlado consumo",
  });
});

test("post-commit: liberación que lanza conserva rechazo y permite cerrar la preferencia", async () => {
  const s = escenarioPostCommit("RECHAZADO");
  s.bus.on("ecommerce:cupon_aplicacion_liberada", () => { throw new Error("fallo controlado liberación"); });
  assert.deepEqual(await s.procesar(), { resultado: "RECHAZADO", pedido_venta_id: "venta-test" });
  assert.deepEqual(s.orden, ["commit-simulado", "stock", "ecommerce:pago_rechazado",
    "ecommerce:cupon_aplicacion_liberada", "cerrarCobro"]);
  assert.equal(s.logs.length, 1);
  assert.match(String(s.logs[0][0]), /post-commit.*ecommerce:cupon_aplicacion_liberada/);
  assert.deepEqual(s.logs[0][1], {
    pedido_venta_id: "venta-test", mercadopago_payment_id: "pago-test", error: "fallo controlado liberación",
  });
});

test("post-commit sin falla: confirmación emite una vez y en el orden vigente", async () => {
  const s = escenarioPostCommit("APROBADO");
  const payloads: unknown[] = [];
  s.bus.on("ecommerce:cupon_consumido", (payload) => payloads.push(payload));
  assert.equal((await s.procesar()).resultado, "CONFIRMADO");
  assert.deepEqual(s.orden, ["commit-simulado", "stock", "ecommerce:pedido_pago_confirmado",
    "ecommerce:cupon_consumido", "ecommerce:pedido_admitido_cola"]);
  assert.deepEqual(payloads, [{
    cupon_id: "cupon-test", actor_tipo: "sistema", actor_id: "canal-web-test",
    ocurrido_en: "2026-10-03T12:00:00.000Z", aplicacion_id: "aplicacion-test", pedido_venta_id: "venta-test",
  }]);
  assert.equal(s.logs.length, 0);
});

test("post-commit sin falla: rechazo emite una vez y en el orden vigente", async () => {
  const s = escenarioPostCommit("RECHAZADO");
  const payloads: unknown[] = [];
  s.bus.on("ecommerce:cupon_aplicacion_liberada", (payload) => payloads.push(payload));
  assert.equal((await s.procesar()).resultado, "RECHAZADO");
  assert.deepEqual(s.orden, ["commit-simulado", "stock", "ecommerce:pago_rechazado",
    "ecommerce:cupon_aplicacion_liberada", "cerrarCobro"]);
  assert.deepEqual(payloads, [{
    cupon_id: "cupon-test", actor_tipo: "sistema", actor_id: "canal-web-test",
    ocurrido_en: "2026-10-03T12:00:00.000Z", aplicacion_id: "aplicacion-test", pedido_venta_id: "venta-test",
    motivo: "Pago rechazado por Mercado Pago",
  }]);
  assert.equal(s.logs.length, 0);
});

test("post-commit: el aislamiento síncrono no captura un rechazo futuro del listener", async () => {
  const s = escenarioPostCommit("APROBADO");
  let falloAsync: Promise<void> | undefined;
  s.bus.on("ecommerce:cupon_consumido", () => {
    const promesa = Promise.resolve().then(() => { throw new Error("fallo async controlado"); });
    // Observar aquí el rechazo evita un unhandledRejection en el runner;
    // no atribuir este manejo al servicio ni al bus de producción.
    falloAsync = assert.rejects(promesa, /fallo async controlado/);
    return promesa;
  });
  assert.equal((await s.procesar()).resultado, "CONFIRMADO");
  assert.ok(falloAsync);
  await falloAsync;
  assert.ok(s.orden.includes("ecommerce:pedido_admitido_cola"));
  assert.equal(s.logs.length, 0);
});
