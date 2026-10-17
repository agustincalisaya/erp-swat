/**
 * HU-E4 / auditoría — sensibilidad al manejo de rechazos async de
 * `registrarAuditLog` en los listeners de cupón.
 *
 * Carga el listener real con dependencias aisladas (sin BD ni bus global),
 * siguiendo el patrón de los unitarios de servicios server-only.
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

interface Fixture {
  bus: Bus;
  iniciarAuditLogListener: () => void;
}

function cargarFixture(
  registrarAuditLog: (params: unknown) => Promise<void>,
  consoleOverride?: { error: (...args: unknown[]) => void },
): Fixture {
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
  if (typeof modulo.exports.iniciarAuditLogListener !== "function") {
    throw new Error("No se exportó iniciarAuditLogListener");
  }
  return { bus, iniciarAuditLogListener: modulo.exports.iniciarAuditLogListener };
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

const MARCADORES_SENSIBLES = "DNI 30123456 postgresql://usuario:clave-secreta@db.interna:5432/erp token=abc123";

const payloadConsumo = {
  cupon_id: "cupon-test",
  actor_tipo: "sistema" as const,
  actor_id: "actor-test",
  ocurrido_en: "2026-10-03T12:00:00.000Z",
  aplicacion_id: "aplicacion-test",
  pedido_venta_id: "venta-test",
};

const payloadLiberacion = {
  ...payloadConsumo,
  motivo: "Pago rechazado por Mercado Pago",
};

function rechazoAsync(mensaje: string): Promise<void> {
  return new Promise((_, reject) => {
    setImmediate(() => reject(new Error(mensaje)));
  });
}

async function drenarMicrotareas(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("auditoría exitosa de cupon_consumido registra exactamente una vez", async () => {
  const llamadas: unknown[] = [];
  const f = cargarFixture(async (params) => {
    llamadas.push(params);
  });
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:cupon_consumido", payloadConsumo);
  await drenarMicrotareas();
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], {
    usuario_id: payloadConsumo.actor_id,
    accion: "ecommerce:cupon_consumido",
    tabla_afectada: "aplicaciones_cupon",
    registro_id: payloadConsumo.aplicacion_id,
    ip: "internal-event",
    valor_anterior: { confirmada: false },
    valor_nuevo: {
      confirmada: true,
      cupon_id: payloadConsumo.cupon_id,
      pedido_venta_id: payloadConsumo.pedido_venta_id,
      actor_tipo: payloadConsumo.actor_tipo,
      ocurrido_en: payloadConsumo.ocurrido_en,
    },
  });
});

test("auditoría exitosa de cupon_aplicacion_liberada registra exactamente una vez", async () => {
  const llamadas: unknown[] = [];
  const f = cargarFixture(async (params) => {
    llamadas.push(params);
  });
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:cupon_aplicacion_liberada", payloadLiberacion);
  await drenarMicrotareas();
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], {
    usuario_id: payloadLiberacion.actor_id,
    accion: "ecommerce:cupon_aplicacion_liberada",
    tabla_afectada: "aplicaciones_cupon",
    registro_id: payloadLiberacion.aplicacion_id,
    ip: "internal-event",
    valor_anterior: { is_active: true },
    valor_nuevo: {
      is_active: false,
      deleted_at: payloadLiberacion.ocurrido_en,
      deletion_reason: payloadLiberacion.motivo,
      cupon_id: payloadLiberacion.cupon_id,
      pedido_venta_id: payloadLiberacion.pedido_venta_id,
      actor_tipo: payloadLiberacion.actor_tipo,
    },
  });
});

test("rechazo async de auditoría de consumo: captura productiva, diagnóstico mínimo y sin unhandledRejection", async (t) => {
  const logs: unknown[][] = [];
  const consola = { ...console, error: (...args: unknown[]) => logs.push(args) };
  const f = cargarFixture(() => rechazoAsync("fallo audit async consumo"), consola);
  const u = observarUnhandledRejection(t);
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:cupon_consumido", payloadConsumo);
  await drenarMicrotareas();
  assert.equal(u.conteo, 0, "se produjo un unhandledRejection");
  assert.equal(logs.length, 1, "debe haber exactamente un diagnóstico");
  assert.match(String(logs[0][0]), /Falló la escritura de auditoría para ecommerce:cupon_consumido/);
  assert.deepEqual(logs[0][1], {
    aplicacion_id: payloadConsumo.aplicacion_id,
    pedido_venta_id: payloadConsumo.pedido_venta_id,
    codigo_error: "ERROR_ESCRITURA_AUDITORIA",
  });
});

test("rechazo async de auditoría de liberación: captura productiva, diagnóstico mínimo y sin unhandledRejection", async (t) => {
  const logs: unknown[][] = [];
  const consola = { ...console, error: (...args: unknown[]) => logs.push(args) };
  const f = cargarFixture(() => rechazoAsync("fallo audit async liberacion"), consola);
  const u = observarUnhandledRejection(t);
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:cupon_aplicacion_liberada", payloadLiberacion);
  await drenarMicrotareas();
  assert.equal(u.conteo, 0, "se produjo un unhandledRejection");
  assert.equal(logs.length, 1, "debe haber exactamente un diagnóstico");
  assert.match(String(logs[0][0]), /Falló la escritura de auditoría para ecommerce:cupon_aplicacion_liberada/);
  assert.deepEqual(logs[0][1], {
    aplicacion_id: payloadLiberacion.aplicacion_id,
    pedido_venta_id: payloadLiberacion.pedido_venta_id,
    codigo_error: "ERROR_ESCRITURA_AUDITORIA",
  });
});

for (const [evento, payload] of [
  ["ecommerce:cupon_consumido", payloadConsumo],
  ["ecommerce:cupon_aplicacion_liberada", payloadLiberacion],
] as const) {
  test(`${evento}: el diagnóstico no traslada mensaje, stack ni propiedades del error`, async (t) => {
    const logs: unknown[][] = [];
    const consola = { ...console, error: (...args: unknown[]) => logs.push(args) };
    const f = cargarFixture(
      () =>
        new Promise<void>((_, reject) => {
          setImmediate(() => {
            const error = new Error(MARCADORES_SENSIBLES) as Error & { meta: unknown; clientVersion: string };
            error.meta = { dni: "30123456" };
            error.clientVersion = MARCADORES_SENSIBLES;
            reject(error);
          });
        }),
      consola,
    );
    const u = observarUnhandledRejection(t);
    f.iniciarAuditLogListener();
    f.bus.emit(evento, payload);
    await drenarMicrotareas();
    assert.equal(u.conteo, 0);
    assert.equal(logs.length, 1);
    const salida = JSON.stringify(logs);
    for (const marcador of ["30123456", "clave-secreta", "db.interna", "abc123", "postgresql://", "Error:", "at "]) {
      assert.equal(salida.includes(marcador), false, `el diagnóstico filtra "${marcador}"`);
    }
    assert.deepEqual(Object.keys(logs[0][1] as object).sort(), ["aplicacion_id", "codigo_error", "pedido_venta_id"]);
    assert.equal((logs[0][1] as { codigo_error: string }).codigo_error, "ERROR_ESCRITURA_AUDITORIA");
  });
}

test("un error Prisma conocido solo aporta su código PXXXX", async (t) => {
  const logs: unknown[][] = [];
  const consola = { ...console, error: (...args: unknown[]) => logs.push(args) };
  const f = cargarFixture(
    () =>
      new Promise<void>((_, reject) => {
        setImmediate(() => reject(Object.assign(new Error(MARCADORES_SENSIBLES), { code: "P2024" })));
      }),
    consola,
  );
  const u = observarUnhandledRejection(t);
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:cupon_consumido", payloadConsumo);
  await drenarMicrotareas();
  assert.equal(u.conteo, 0);
  assert.equal((logs[0][1] as { codigo_error: string }).codigo_error, "P2024");
  assert.equal(JSON.stringify(logs).includes("clave-secreta"), false);
});

test("un code arbitrario (no PXXXX) no se registra", async (t) => {
  const logs: unknown[][] = [];
  const consola = { ...console, error: (...args: unknown[]) => logs.push(args) };
  const f = cargarFixture(
    () =>
      new Promise<void>((_, reject) => {
        setImmediate(() => reject(Object.assign(new Error("x"), { code: "dni=30123456" })));
      }),
    consola,
  );
  const u = observarUnhandledRejection(t);
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:cupon_consumido", payloadConsumo);
  await drenarMicrotareas();
  assert.equal(u.conteo, 0);
  assert.equal((logs[0][1] as { codigo_error: string }).codigo_error, "ERROR_ESCRITURA_AUDITORIA");
});

test("rechazo async de consumo no bloquea un evento posterior de liberación", async (t) => {
  const llamadas: { accion: string; params: unknown }[] = [];
  const logs: unknown[][] = [];
  const consola = { ...console, error: (...args: unknown[]) => logs.push(args) };
  const f = cargarFixture(async (params: unknown) => {
    const p = params as { accion: string };
    llamadas.push({ accion: p.accion, params });
    if (p.accion === "ecommerce:cupon_consumido") await rechazoAsync("fallo audit async consumo");
  }, consola);
  const u = observarUnhandledRejection(t);
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:cupon_consumido", payloadConsumo);
  f.bus.emit("ecommerce:cupon_aplicacion_liberada", payloadLiberacion);
  await drenarMicrotareas();
  assert.equal(u.conteo, 0, "se produjo un unhandledRejection");
  assert.equal(llamadas.length, 2, "ambos eventos deben intentar registrarse");
  assert.equal(llamadas[0].accion, "ecommerce:cupon_consumido");
  assert.equal(llamadas[1].accion, "ecommerce:cupon_aplicacion_liberada");
  assert.equal(logs.length, 1, "solo el consumo fallido debe diagnosticarse");
  assert.match(String(logs[0][0]), /ecommerce:cupon_consumido/);
});

test("HU-E3 audita entrega agregada B/E usando ID de extensión y datos mínimos", async () => {
  const llamadas: unknown[] = [];
  const f = cargarFixture(async (params) => { llamadas.push(params); });
  f.iniciarAuditLogListener();
  f.bus.emit("ecommerce:pedido_entregado", {
    evento_id: "evento-e3-1", pedido_venta_id: "venta-e3-1",
    pedido_venta_ecommerce_id: "extension-e3-1", actor_id: "actor-e3-1",
    estado_anterior: "LISTO_PARA_RETIRO", estado_nuevo: "ENTREGADO",
    timestamp: "2026-10-06T12:00:00.000Z",
  });
  await drenarMicrotareas();
  assert.deepEqual(llamadas, [{
    usuario_id: "actor-e3-1", accion: "PEDIDO_ENTREGADO",
    tabla_afectada: "pedidos_venta_ecommerce", registro_id: "extension-e3-1",
    ip: "internal-event",
    valor_anterior: { estado_ecommerce: "LISTO_PARA_RETIRO", estado_pedido_venta: "FACTURADO" },
    valor_nuevo: {
      evento_id: "evento-e3-1", pedido_venta_id: "venta-e3-1",
      estado_ecommerce: "ENTREGADO", estado_pedido_venta: "CERRADO",
      qr_consumido: true, entrega_total: true, timestamp: "2026-10-06T12:00:00.000Z",
    },
  }]);
});

test("HU-E3 audita rechazo con ID de extensión o null, sin usar ID de venta como sustituto", async () => {
  const llamadas: unknown[] = [];
  const f = cargarFixture(async (params) => { llamadas.push(params); });
  f.iniciarAuditLogListener();
  const base = {
    evento_id: "evento-e3-r", actor_id: "actor-e3-r",
    motivo: "DNI_NO_COINCIDE", timestamp: "2026-10-06T12:01:00.000Z",
  };
  f.bus.emit("ecommerce:retiro_rechazado", {
    ...base, pedido_venta_id: "venta-e3-r", pedido_venta_ecommerce_id: "extension-e3-r",
  });
  f.bus.emit("ecommerce:retiro_rechazado", {
    ...base, evento_id: "evento-e3-sin-id", motivo: "TOKEN_NO_RESUELTO",
  });
  await drenarMicrotareas();
  assert.equal(llamadas.length, 2);
  assert.deepEqual(llamadas[0], {
    usuario_id: "actor-e3-r", accion: "RETIRO_RECHAZADO",
    tabla_afectada: "pedidos_venta_ecommerce", registro_id: "extension-e3-r",
    ip: "internal-event", valor_anterior: null,
    valor_nuevo: {
      evento_id: "evento-e3-r", motivo: "DNI_NO_COINCIDE",
      timestamp: "2026-10-06T12:01:00.000Z", pedido_venta_id: "venta-e3-r",
    },
  });
  assert.deepEqual(llamadas[1], {
    usuario_id: "actor-e3-r", accion: "RETIRO_RECHAZADO",
    tabla_afectada: "pedidos_venta_ecommerce", registro_id: null,
    ip: "internal-event", valor_anterior: null,
    valor_nuevo: {
      evento_id: "evento-e3-sin-id", motivo: "TOKEN_NO_RESUELTO",
      timestamp: "2026-10-06T12:01:00.000Z",
    },
  });
});

test("HU-E3: fallo del ledger se captura sin exponer el error ni rechazar el bus", async (t) => {
  const logs: unknown[][] = [];
  const f = cargarFixture(
    async () => { throw new Error(MARCADORES_SENSIBLES); },
    { error: (...args: unknown[]) => logs.push(args) },
  );
  const u = observarUnhandledRejection(t);
  f.iniciarAuditLogListener();
  assert.equal(f.bus.emit("ecommerce:pedido_entregado", {
    evento_id: "evento-e3-fallo", pedido_venta_id: "venta-e3-fallo",
    pedido_venta_ecommerce_id: "extension-e3-fallo", actor_id: "actor-e3-fallo",
    estado_anterior: "LISTO_PARA_RETIRO", estado_nuevo: "ENTREGADO",
    timestamp: "2026-10-06T12:02:00.000Z",
  }), true);
  await drenarMicrotareas();
  assert.equal(u.conteo, 0);
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify(logs).includes(MARCADORES_SENSIBLES), false);
});
