/**
 * HU-E6 / auditoría — handlers de `ecommerce:transaccion_pago_registrada` y
 * `ecommerce:acceso_dato_cifrado_auditado`. Mismo arnés que
 * `audit-log.listener.e5.test.ts`: el listener real con dependencias aisladas,
 * sin BD ni bus global, para poder inyectar un rechazo de `registrarAuditLog`.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";

interface Bus extends EventEmitter {
  emit: (event: string, payload: unknown) => boolean;
}

function cargarListener(
  registrarAuditLog: (params: unknown) => Promise<void>,
  consola: { error: (...args: unknown[]) => void } = console,
): Bus {
  const bus: Bus = new EventEmitter() as Bus;
  const dependencias: Record<string, unknown> = {
    "server-only": {},
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/services/auditoria/audit-log.service": { registrarAuditLog },
  };
  const ruta = "./audit-log.listener.ts";
  const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
  const codigo = transpileModule(fuente, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const modulo: { exports: { iniciarAuditLogListener?: () => void } } = { exports: {} };
  runInThisContext(`(function(require, module, exports, console) {\n${codigo}\n})`, { filename: ruta })(
    (nombre: string) => {
      if (!Object.hasOwn(dependencias, nombre)) throw new Error(`Dependencia inesperada: ${nombre}`);
      return dependencias[nombre];
    },
    modulo,
    modulo.exports,
    consola,
  );
  modulo.exports.iniciarAuditLogListener!();
  return bus;
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

const drenar = () => new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
const rechazoConDatosSensibles = () =>
  new Promise<void>((_, reject) => {
    setImmediate(() =>
      reject(Object.assign(new Error("postgresql://u:clave-secreta@db tarjeta 4111 1111 1111 1111"), { meta: { cvv: "123" } })),
    );
  });

const transaccion = {
  transaccion_id: "tx-1",
  pedido_venta_id: "venta-1",
  monto: 9000,
  estado_pago: "APROBADO" as const,
  mercadopago_payment_id: "pago-1",
};
const acceso = {
  transaccion_id: "tx-1",
  usuario_auditor_id: "auditor-1",
  timestamp: "2026-10-07T00:00:00.000Z",
};

test("transaccion_pago_registrada: asiento del sistema sin datos de facturación ni de tarjeta", async () => {
  const llamadas: unknown[] = [];
  const bus = cargarListener(async (p) => void llamadas.push(p));
  bus.emit("ecommerce:transaccion_pago_registrada", transaccion);
  await drenar();
  assert.deepEqual(llamadas, [
    {
      usuario_id: null,
      accion: "TRANSACCION_PAGO_REGISTRADA",
      tabla_afectada: "log_transacciones_pago",
      registro_id: "tx-1",
      ip: "internal-event",
      valor_anterior: null,
      valor_nuevo: {
        pedido_venta_id: "venta-1",
        monto: 9000,
        estado_pago: "APROBADO",
        mercadopago_payment_id: "pago-1",
      },
    },
  ]);
  const serializado = JSON.stringify(llamadas);
  for (const marcador of ["datos_facturacion", "dni", "email", "telefono", "tarjeta", "cvv"]) {
    assert.equal(serializado.includes(marcador), false, marcador);
  }
});

test("acceso_dato_cifrado_auditado: asiento con el Auditor como actor y solo el timestamp", async () => {
  const llamadas: unknown[] = [];
  const bus = cargarListener(async (p) => void llamadas.push(p));
  bus.emit("ecommerce:acceso_dato_cifrado_auditado", acceso);
  await drenar();
  assert.deepEqual(llamadas, [
    {
      usuario_id: "auditor-1",
      accion: "ACCESO_DATO_CIFRADO_AUDITADO",
      tabla_afectada: "log_transacciones_pago",
      registro_id: "tx-1",
      ip: "internal-event",
      valor_anterior: null,
      valor_nuevo: { timestamp: "2026-10-07T00:00:00.000Z" },
    },
  ]);
});

for (const [evento, payload] of [
  ["ecommerce:transaccion_pago_registrada", transaccion],
  ["ecommerce:acceso_dato_cifrado_auditado", acceso],
] as const) {
  test(`${evento}: un rechazo de registrarAuditLog no produce unhandledRejection ni filtra datos`, async (t) => {
    const logs: unknown[][] = [];
    const u = observarUnhandledRejection(t);
    const bus = cargarListener(rechazoConDatosSensibles, { error: (...args: unknown[]) => void logs.push(args) });
    bus.emit(evento, payload);
    await drenar();
    assert.equal(u.conteo, 0, "se produjo un unhandledRejection");
    const salida = JSON.stringify(logs);
    for (const marcador of ["clave-secreta", "4111 1111 1111 1111", "postgresql://", "cvv"]) {
      assert.equal(salida.includes(marcador), false, marcador);
    }
  });
}
