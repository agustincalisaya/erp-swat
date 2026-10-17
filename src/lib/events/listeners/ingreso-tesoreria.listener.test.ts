/**
 * HU-G11 — listener reactivo de ingresos de Tesorería.
 *
 * Carga el listener real con dependencias aisladas (sin BD ni bus global),
 * siguiendo el patrón de `audit-log.listener.test.ts`. Verifica: registro
 * único, delegación al service en un payload válido, emisión del evento de
 * seguimiento post-commit y aislamiento de una falla del service (loguea con
 * los dos ids y NUNCA la propaga al bus).
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import type { PedidoPagoConfirmadoPayload } from "@/lib/events/event-types.ts";

interface Bus extends EventEmitter {
  emit: (event: string, payload: unknown) => boolean;
}

type RegistrarIngresoWeb = (input: unknown) => Promise<unknown>;

interface Fixture {
  bus: Bus;
  iniciarIngresoTesoreriaListener: () => void;
}

function cargarFixture(
  registrarIngresoWeb: RegistrarIngresoWeb,
  consoleOverride?: { error: (...args: unknown[]) => void },
): Fixture {
  const bus: Bus = new EventEmitter() as Bus;
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/services/tesoreria/ingreso-tesoreria.service": { registrarIngresoWeb },
  };
  const ruta = "./ingreso-tesoreria.listener.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: { iniciarIngresoTesoreriaListener?: () => void } } = { exports: {} };
  const ejecutar = runInThisContext(
    `(function(require, module, exports, console) {\n${codigo}\n})`,
    { filename: ruta },
  );
  ejecutar(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) {
        throw new Error(`Dependencia inesperada: ${nombre}`);
      }
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
    consoleOverride ?? console,
  );
  if (typeof modulo.exports.iniciarIngresoTesoreriaListener !== "function") {
    throw new Error("No se exportó iniciarIngresoTesoreriaListener");
  }
  return { bus, iniciarIngresoTesoreriaListener: modulo.exports.iniciarIngresoTesoreriaListener };
}

function observarUnhandledRejection(t: TestContext): { readonly conteo: number } {
  const estado = { conteo: 0 };
  const handler = () => {
    estado.conteo += 1;
  };
  process.on("unhandledRejection", handler);
  t.after(() => {
    process.off("unhandledRejection", handler);
  });
  return {
    get conteo() {
      return estado.conteo;
    },
  };
}

async function drenarMicrotareas(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const payload: PedidoPagoConfirmadoPayload = {
  pedido_venta_id: "pedido-test",
  pedido_venta_ecommerce_id: "pve-test",
  numero_venta: "V-0001",
  cliente_id: "cliente-test",
  cliente_web_cuenta_id: "cuenta-test",
  mercadopago_payment_id: "mp-123",
  monto: 1234.5,
  moneda: "ARS",
  fecha_aprobacion: "2026-10-06T12:00:00.000Z",
  comprobante_id: "comprobante-test",
  cupon_aplicacion_id: null,
};

const eventoIngreso = "tesoreria:ingreso_web_registrado";

test("el listener se registra una sola vez (guard `registrado`)", async () => {
  let llamadas = 0;
  const f = cargarFixture(async () => {
    llamadas += 1;
    return null;
  });
  f.iniciarIngresoTesoreriaListener();
  f.iniciarIngresoTesoreriaListener();
  f.bus.emit("ecommerce:pedido_pago_confirmado", payload);
  await drenarMicrotareas();
  assert.equal(llamadas, 1);
});

test("un payload válido llama al service y emite el evento de seguimiento post-commit", async () => {
  const recibidos: unknown[] = [];
  const f = cargarFixture(async (input) => {
    recibidos.push(input);
    return {
      ingreso_id: "ingreso-1",
      pedido_venta_id: payload.pedido_venta_id,
      mercadopago_payment_id: payload.mercadopago_payment_id,
      monto: "1234.50",
      fecha: payload.fecha_aprobacion,
      estado: "PENDIENTE_CONCILIACION",
      caja_virtual: "MERCADO_PAGO_CANAL_WEB",
    };
  });
  const emitidos: unknown[] = [];
  f.bus.on(eventoIngreso, (p) => emitidos.push(p));

  f.iniciarIngresoTesoreriaListener();
  f.bus.emit("ecommerce:pedido_pago_confirmado", payload);
  await drenarMicrotareas();

  assert.equal(recibidos.length, 1);
  assert.deepEqual(recibidos[0], payload);
  assert.equal(emitidos.length, 1);
  assert.equal((emitidos[0] as { ingreso_id: string }).ingreso_id, "ingreso-1");
});

test("un no-op del service (null) no emite evento de seguimiento", async () => {
  const f = cargarFixture(async () => null);
  const emitidos: unknown[] = [];
  f.bus.on(eventoIngreso, (p) => emitidos.push(p));

  f.iniciarIngresoTesoreriaListener();
  f.bus.emit("ecommerce:pedido_pago_confirmado", payload);
  await drenarMicrotareas();

  assert.equal(emitidos.length, 0);
});

test("una falla del service se loguea con los dos ids y no se propaga al bus", async (t) => {
  const logs: unknown[][] = [];
  const consola = { ...console, error: (...args: unknown[]) => logs.push(args) };
  const f = cargarFixture(() => {
    return new Promise((_, reject) => {
      setImmediate(() => reject(new Error("fallo service")));
    });
  }, consola);
  const u = observarUnhandledRejection(t);

  f.iniciarIngresoTesoreriaListener();
  f.bus.emit("ecommerce:pedido_pago_confirmado", payload);
  await drenarMicrotareas();

  assert.equal(u.conteo, 0, "se produjo un unhandledRejection");
  assert.equal(logs.length, 1, "debe haber exactamente un diagnóstico");
  assert.match(
    String(logs[0][0]),
    /fallo procesando ecommerce:pedido_pago_confirmado/,
  );
  assert.deepEqual(logs[0][1], {
    pedido_venta_id: payload.pedido_venta_id,
    mercadopago_payment_id: payload.mercadopago_payment_id,
    error: (logs[0][1] as { error: unknown }).error,
  });
});
