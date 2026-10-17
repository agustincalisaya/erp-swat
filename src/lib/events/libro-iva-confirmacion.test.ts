import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ConfirmacionesLibroIva } from "./libro-iva-confirmacion.ts";
import { cargarAislado } from "../services/ecommerce/comprobante-pdf.test-helpers.ts";

test("G4 confirmaciones: concurrencia, limpieza, timeout, duplicado y respuestas tardías", async () => {
  const r = new ConfirmacionesLibroIva();
  const a = r.esperar("a", 100);
  const b = r.esperar("b", 100);
  assert.throws(() => r.esperar("a"));
  r.confirmar("b", false);
  r.confirmar("a", true);
  assert.equal(await a.resultado, true);
  assert.equal(await b.resultado, false);
  const vencida = r.esperar("vieja", 5);
  assert.equal(await vencida.resultado, false);
  const nueva = r.esperar("nueva", 100);
  r.confirmar("vieja", true);
  assert.equal(r.cantidadPendiente, 1);
  nueva.cancelar();
  assert.equal(await nueva.resultado, false);
  assert.equal(r.cantidadPendiente, 0);
});

test("G4 listener central confirma después del append y rechaza fallos; whitelist sin PII", async () => {
  const r = new ConfirmacionesLibroIva();
  const bus = new EventEmitter();
  let finalizar!: () => void;
  let rechazar!: () => void;
  let parametros: Record<string, unknown> = {};
  const dependencias = {
    "server-only": {}, "@/lib/db/prisma": { prisma: {} },
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/events/libro-iva-confirmacion": { confirmacionesLibroIva: r },
    "@/lib/services/auditoria/audit-log.service": {
      registrarAuditLog: (p: Record<string, unknown>) => { parametros = p; return new Promise<void>((resolve, reject) => { finalizar = resolve; rechazar = () => reject(new Error("dato privado")); }); },
    },
  };
  const cargarListener = () => cargarAislado<{ iniciarAuditLogListener: () => void }>(new URL("./listeners/audit-log.listener.ts", import.meta.url), dependencias);
  const listener = cargarListener();
  listener.iniciarAuditLogListener();
  listener.iniciarAuditLogListener();
  cargarListener().iniciarAuditLogListener();
  assert.equal(bus.listenerCount("tesoreria:libro_iva_exportado"), 1);
  const a = r.esperar("a");
  bus.emit("tesoreria:libro_iva_exportado", { exportacion_id: "a", usuario_id: "actor", periodo: "2026-10", tipo_libro: "VENTAS", timestamp: "ahora", dni: "no persistir", filas: ["no persistir"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.cantidadPendiente, 1);
  finalizar();
  assert.equal(await a.resultado, true);
  assert.deepEqual(parametros.valor_nuevo, { exportacion_id: "a", periodo: "2026-10", tipo_libro: "VENTAS", formato: "TXT", timestamp: "ahora" });
  assert.equal(parametros.usuario_id, "actor");
  const b = r.esperar("b");
  bus.emit("tesoreria:libro_iva_exportado", { exportacion_id: "b" });
  await new Promise((resolve) => setImmediate(resolve));
  rechazar();
  assert.equal(await b.resultado, false);
  assert.equal(r.cantidadPendiente, 0);
});

test("G4 productor espera inicialización y confirmación; ausencia, rechazo y timeout son error seguro", async () => {
  for (const caso of ["exito", "ausente", "fallo", "timeout", "inicio-fallido", "inicio-colgado", "throw"] as const) {
    const r = new ConfirmacionesLibroIva();
    let emitidos = 0;
    const payloads: Record<string, unknown>[] = [];
    const bus = { emit: (_: string, p: Record<string, unknown>) => {
      emitidos++; payloads.push(p);
      if (caso === "throw") throw new Error("dato privado");
      if (caso === "exito") setTimeout(() => r.confirmar(p.exportacion_id as string, true), 2);
      if (caso === "fallo") r.confirmar(p.exportacion_id as string, false);
      return caso !== "ausente";
    } };
    const { ServiceError } = await import("../errors/service-error.ts");
    const modulo = cargarAislado<{ auditarExportacionLibroIva: (datos: object) => Promise<void> }>(new URL("./libro-iva-auditoria.ts", import.meta.url), {
      "server-only": {}, "@/lib/errors/service-error": { ServiceError },
      "@/lib/events/domain-event-bus": { domainEventBus: bus, listenersRegistrados: caso === "inicio-fallido" ? Promise.reject(new Error("inicio")) : caso === "inicio-colgado" ? new Promise(() => {}) : Promise.resolve() },
      "@/lib/events/libro-iva-confirmacion": { confirmacionesLibroIva: { esperar: (id: string) => r.esperar(id, 200) } },
    });
    const operacion = modulo.auditarExportacionLibroIva({ usuario_id: "actor", periodo: "2026-10", tipo_libro: "VENTAS" });
    if (caso === "exito") await operacion;
    else await assert.rejects(operacion, (e: unknown) => e instanceof ServiceError && e.code === "LIBRO_IVA_AUDITORIA_NO_CONFIRMADA" && !e.message.includes("privado"));
    assert.equal(r.cantidadPendiente, 0);
    if (caso.startsWith("inicio")) assert.equal(emitidos, 0);
    if (payloads.length) assert.deepEqual(Object.keys(payloads[0]!).sort(), ["exportacion_id", "periodo", "timestamp", "tipo_libro", "usuario_id"]);
  }
});
