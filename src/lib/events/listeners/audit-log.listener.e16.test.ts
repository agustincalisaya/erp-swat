/**
 * HU-E16 / auditoría — handler de `ecommerce:publicacion_web_rechazada` y
 * productor que espera la confirmación (spec E §6.2, E16-4;
 * docs/modulos/modulo E/HU16_TASKS.md T02). Arnés de `libro-iva-confirmacion.test.ts`:
 * el listener y el productor reales con dependencias aisladas, sin BD ni bus global.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ConfirmacionesPublicacionWeb } from "../publicacion-web-confirmacion.ts";
import { ServiceError } from "../../errors/service-error.ts";
import { cargarAislado } from "../../services/ecommerce/comprobante-pdf.test-helpers.ts";

const EVENTO = "ecommerce:publicacion_web_rechazada";
const tick = () => new Promise((resolve) => setImmediate(resolve));

function cargarListener(bus: EventEmitter, r: ConfirmacionesPublicacionWeb, registrarAuditLog: (p: Record<string, unknown>) => Promise<void>) {
  return cargarAislado<{ iniciarAuditLogListener: () => void }>(new URL("./audit-log.listener.ts", import.meta.url), {
    "server-only": {},
    "@/lib/db/prisma": { prisma: {} },
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/events/publicacion-web-confirmacion": { confirmacionesPublicacionWeb: r },
    "@/lib/services/auditoria/audit-log.service": { registrarAuditLog },
  });
}

function cargarProductor(bus: EventEmitter, r: ConfirmacionesPublicacionWeb, listenersRegistrados: Promise<void> = Promise.resolve()) {
  return cargarAislado<{
    auditarRechazoPublicacionWeb: (d: { actor_id: string; producto_web_id: string; faltantes: string[] }) => Promise<void>;
  }>(new URL("../publicacion-web-auditoria.ts", import.meta.url), {
    "server-only": {},
    "@/lib/events/domain-event-bus": { domainEventBus: bus, listenersRegistrados },
    "@/lib/events/publicacion-web-confirmacion": { confirmacionesPublicacionWeb: r },
    "@/lib/errors/service-error": { ServiceError },
  });
}

const DATOS = { actor_id: "actor", producto_web_id: "contenido-1", faltantes: ["foto"] };

test("E16-4 listener: un solo handler aunque se inicie y recargue varias veces", () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  const registrar = async () => {};
  const listener = cargarListener(bus, r, registrar);
  listener.iniciarAuditLogListener();
  listener.iniciarAuditLogListener();
  cargarListener(bus, r, registrar).iniciarAuditLogListener();
  assert.equal(bus.listenerCount(EVENTO), 1);
});

test("E16-4 listener: confirma solo después de persistir; whitelist sin descripción ni URLs", async () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  let finalizar!: () => void;
  let parametros: Record<string, unknown> = {};
  cargarListener(bus, r, (p) => {
    parametros = p;
    return new Promise<void>((resolve) => { finalizar = resolve; });
  }).iniciarAuditLogListener();

  const espera = r.esperar("i-1");
  bus.emit(EVENTO, {
    intento_id: "i-1",
    actor_id: "actor",
    producto_web_id: "contenido-1",
    faltantes: ["descripcion", "foto"],
    timestamp: "2026-10-20T12:00:00.000Z",
    descripcion: "no persistir",
    url: "https://no-persistir",
    fotos: ["https://no-persistir"],
  });
  await tick();
  assert.equal(r.cantidadPendiente, 1, "no confirma antes de que termine registrarAuditLog");
  finalizar();
  assert.equal(await espera.resultado, true);
  assert.deepEqual(parametros, {
    usuario_id: "actor",
    accion: EVENTO,
    tabla_afectada: "contenidos_producto_web",
    registro_id: "contenido-1",
    ip: "internal-event",
    valor_anterior: null,
    valor_nuevo: { intento_id: "i-1", faltantes: ["descripcion", "foto"], timestamp: "2026-10-20T12:00:00.000Z" },
  });
});

test("E16-4 listener: si registrarAuditLog falla confirma false, sin rechazos sin manejar", async (t) => {
  let sinManejar = 0;
  const contar = () => { sinManejar += 1; };
  process.on("unhandledRejection", contar);
  t.after(() => process.off("unhandledRejection", contar));
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  cargarListener(bus, r, () => Promise.reject(new Error("dato privado"))).iniciarAuditLogListener();
  const espera = r.esperar("i-2");
  bus.emit(EVENTO, { intento_id: "i-2", actor_id: "a", producto_web_id: "c", faltantes: ["foto"], timestamp: "t" });
  assert.equal(await espera.resultado, false);
  await tick();
  assert.equal(sinManejar, 0);
  assert.equal(r.cantidadPendiente, 0);
});

test("E16-4 listener: rechazos repetidos del mismo contenido → un asiento por intento_id", async () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  const asientos: Record<string, unknown>[] = [];
  cargarListener(bus, r, async (p) => { asientos.push(p); }).iniciarAuditLogListener();
  const productor = cargarProductor(bus, r);
  await productor.auditarRechazoPublicacionWeb(DATOS);
  await productor.auditarRechazoPublicacionWeb(DATOS);
  await productor.auditarRechazoPublicacionWeb(DATOS);
  assert.equal(asientos.length, 3);
  const ids = asientos.map((a) => (a.valor_nuevo as { intento_id: string }).intento_id);
  assert.equal(new Set(ids).size, 3);
  for (const a of asientos) assert.equal(a.registro_id, "contenido-1");
  assert.equal(r.cantidadPendiente, 0);
});

test("E16-4 productor: falla del listener → AUDITORIA_NO_DISPONIBLE", async () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  cargarListener(bus, r, () => Promise.reject(new Error("x"))).iniciarAuditLogListener();
  await assert.rejects(cargarProductor(bus, r).auditarRechazoPublicacionWeb(DATOS), (e: unknown) =>
    e instanceof ServiceError && e.code === "AUDITORIA_NO_DISPONIBLE");
  assert.equal(r.cantidadPendiente, 0);
});

test("E16-4 productor: sin listener → AUDITORIA_NO_DISPONIBLE inmediato", async () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  const inicio = Date.now();
  await assert.rejects(cargarProductor(bus, r).auditarRechazoPublicacionWeb(DATOS), (e: unknown) =>
    e instanceof ServiceError && e.code === "AUDITORIA_NO_DISPONIBLE");
  assert.ok(Date.now() - inicio < 1_000);
  assert.equal(r.cantidadPendiente, 0);
});

test("E16-4 productor: timeout del listener → AUDITORIA_NO_DISPONIBLE y espera limpia", async () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  r.plazoMs = 30;
  bus.on(EVENTO, () => {}); // escucha pero nunca confirma
  await assert.rejects(cargarProductor(bus, r).auditarRechazoPublicacionWeb(DATOS), (e: unknown) =>
    e instanceof ServiceError && e.code === "AUDITORIA_NO_DISPONIBLE");
  assert.equal(r.cantidadPendiente, 0);
});

test("E16-4 productor: la espera se registra ANTES de emitir y el payload no lleva datos extra", async () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  let payload: Record<string, unknown> = {};
  bus.on(EVENTO, (p: Record<string, unknown>) => {
    payload = p;
    assert.equal(r.cantidadPendiente, 1);
    r.confirmar(p.intento_id as string, true); // confirmación síncrona: igual debe resolver
  });
  await cargarProductor(bus, r).auditarRechazoPublicacionWeb(DATOS);
  assert.deepEqual(Object.keys(payload).sort(), ["actor_id", "faltantes", "intento_id", "producto_web_id", "timestamp"]);
  assert.match(payload.intento_id as string, /^[0-9a-f-]{36}$/);
});

test("E16-4 productor: bus sin inicializar (listenersRegistrados rechaza) → AUDITORIA_NO_DISPONIBLE", async () => {
  const bus = new EventEmitter();
  const r = new ConfirmacionesPublicacionWeb();
  let emitidos = 0;
  bus.on(EVENTO, () => { emitidos += 1; });
  await assert.rejects(
    cargarProductor(bus, r, Promise.reject(new Error("init"))).auditarRechazoPublicacionWeb(DATOS),
    (e: unknown) => e instanceof ServiceError && e.code === "AUDITORIA_NO_DISPONIBLE",
  );
  assert.equal(emitidos, 0);
});
