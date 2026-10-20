import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { cargarAislado } from "../services/ecommerce/comprobante-pdf.test-helpers.ts";
import { ConfirmacionesReporteMensual } from "./reporte-mensual-confirmacion.ts";
import { ServiceError } from "../errors/service-error.ts";

test("G16 listener: una suscripción, whitelist y confirmación tras append", async () => {
  const bus = new EventEmitter();
  const confirmacionesReporteMensual = new ConfirmacionesReporteMensual();
  let terminar!: () => void;
  let datos: Record<string, unknown> = {};
  const deps = {
    "server-only": {}, "@/lib/db/prisma": { prisma: {} },
    "@/lib/events/domain-event-bus": { domainEventBus: bus },
    "@/lib/events/reporte-mensual-confirmacion": { confirmacionesReporteMensual },
    "@/lib/services/auditoria/audit-log.service": {
      registrarAuditLog: async () => {},
      registrarAuditLogIdempotente: (p: Record<string, unknown>) => {
        datos = p;
        return new Promise<void>((resolve) => { terminar = resolve; });
      },
    },
  };
  const cargar = () => cargarAislado<{ iniciarAuditLogListener: () => void }>(new URL("./listeners/audit-log.listener.ts", import.meta.url), deps);
  cargar().iniciarAuditLogListener();
  cargar().iniciarAuditLogListener();
  assert.equal(bus.listenerCount("tesoreria:reporte_exportado"), 1);
  const espera = confirmacionesReporteMensual.esperar("uno", 1000);
  bus.emit("tesoreria:reporte_exportado", { exportacion_id: "uno", usuario_id: "actor", anio: 2026, mes: 10,
    formato: "CSV", timestamp: "ahora", importe: "SECRETO", proveedor: "SECRETO", filas: ["SECRETO"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(datos.usuario_id, "actor");
  assert.equal(datos.accion, "REPORTE_MENSUAL_EXPORTADO");
  assert.deepEqual(datos.valor_nuevo, { exportacion_id: "uno", anio: 2026, mes: 10, formato: "CSV", timestamp: "ahora" });
  terminar();
  assert.equal(await espera.resultado, true);
});

test("G16 productor: un evento, campos mínimos y fallo de auditoría seguro", async () => {
  const confirmacionesReporteMensual = new ConfirmacionesReporteMensual();
  const emitidos: Record<string, unknown>[] = [];
  const bus = { emit: (_evento: string, payload: Record<string, unknown>) => {
    emitidos.push(payload);
    confirmacionesReporteMensual.confirmar(payload.exportacion_id as string, true);
    return true;
  } };
  const modulo = cargarAislado<{ auditarExportacionReporte: (datos: object) => Promise<void> }>(
    new URL("./reporte-mensual-auditoria.ts", import.meta.url), {
      "server-only": {}, "@/lib/errors/service-error": { ServiceError },
      "@/lib/events/domain-event-bus": { domainEventBus: bus, listenersRegistrados: Promise.resolve() },
      "./reporte-mensual-confirmacion": { confirmacionesReporteMensual },
    });
  await modulo.auditarExportacionReporte({ usuario_id: "actor", anio: 2026, mes: 10, formato: "PDF" });
  assert.equal(emitidos.length, 1);
  assert.deepEqual(Object.keys(emitidos[0]).sort(), ["anio", "exportacion_id", "formato", "mes", "timestamp", "usuario_id"]);
  assert.match(emitidos[0].timestamp as string, /^\d{4}-\d{2}-\d{2}T/);
  const ausente = cargarAislado<{ auditarExportacionReporte: (datos: object) => Promise<void> }>(
    new URL("./reporte-mensual-auditoria.ts", import.meta.url), {
      "server-only": {}, "@/lib/errors/service-error": { ServiceError },
      "@/lib/events/domain-event-bus": { domainEventBus: { emit: () => false }, listenersRegistrados: Promise.resolve() },
      "./reporte-mensual-confirmacion": { confirmacionesReporteMensual },
    });
  await assert.rejects(ausente.auditarExportacionReporte({ usuario_id: "actor", anio: 2026, mes: 10, formato: "CSV" }),
    (e: unknown) => e instanceof ServiceError && e.code === "REPORTE_AUDITORIA_NO_CONFIRMADA");
});
