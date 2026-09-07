import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { superaUmbral, UMBRAL_BAJA_MERMA_UNIDADES } from "../../config/reclasificacion.config.ts";
import {
  ReclasificarDevueltoSchema,
  RechazarSolicitudSchema,
  SolicitudReclasificacionIdSchema,
} from "../../schemas/inventario.schema.ts";

const variante = "11111111-1111-4111-8111-111111111111";
const deposito = "22222222-2222-4222-8222-222222222222";
const rma = "33333333-3333-4333-8333-333333333333";

const leerServicio = () =>
  readFileSync(new URL("./reclasificacion.service.ts", import.meta.url), "utf8");

const sliceReclasificarDevuelto = (fuente: string) =>
  fuente.slice(
    fuente.indexOf("export async function reclasificarDevuelto"),
    fuente.indexOf("export async function aprobarSolicitud"),
  );

const sliceAprobarSolicitud = (fuente: string) =>
  fuente.slice(
    fuente.indexOf("export async function aprobarSolicitud"),
    fuente.indexOf("export async function rechazarSolicitud"),
  );

const sliceRechazarSolicitud = (fuente: string) =>
  fuente.slice(
    fuente.indexOf("export async function rechazarSolicitud"),
    fuente.indexOf("export async function listarSolicitudesPendientes"),
  );

// ── Schemas Zod ───────────────────────────────────────────────────────────────

test("ReclasificarDevueltoSchema acepta una reclasificación APTO válida con y sin rma_id", () => {
  assert.equal(
    ReclasificarDevueltoSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
      resultado_control_calidad: "APTO",
    }).success,
    true,
  );
  assert.equal(
    ReclasificarDevueltoSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
      resultado_control_calidad: "APTO",
      rma_id: rma,
    }).success,
    true,
  );
});

test("ReclasificarDevueltoSchema exige motivo cuando resultado_control_calidad = NO_APTO", () => {
  const parsed = ReclasificarDevueltoSchema.safeParse({
    variante_sku_id: variante,
    deposito_id: deposito,
    cantidad: 1,
    resultado_control_calidad: "NO_APTO",
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const issuesEnMotivo = parsed.error.issues.filter((issue) => issue.path[0] === "motivo");
    assert.ok(issuesEnMotivo.length > 0, "el issue debe apuntar a path ['motivo']");
  }
});

test("ReclasificarDevueltoSchema acepta NO_APTO con motivo y rechaza NO_APTO con motivo vacío", () => {
  assert.equal(
    ReclasificarDevueltoSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
      resultado_control_calidad: "NO_APTO",
      motivo: "Rotura de manga durante la garantía",
    }).success,
    true,
  );
  assert.equal(
    ReclasificarDevueltoSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
      resultado_control_calidad: "NO_APTO",
      motivo: "   ",
    }).success,
    false,
  );
});

test("ReclasificarDevueltoSchema rechaza UUIDs inválidos, resultado fuera de enum y cantidad no positiva", () => {
  assert.equal(
    ReclasificarDevueltoSchema.safeParse({
      variante_sku_id: "no-es-uuid",
      deposito_id: deposito,
      cantidad: 1,
      resultado_control_calidad: "APTO",
    }).success,
    false,
  );
  assert.equal(
    ReclasificarDevueltoSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: "no-es-uuid",
      cantidad: 1,
      resultado_control_calidad: "APTO",
    }).success,
    false,
  );
  assert.equal(
    ReclasificarDevueltoSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
      resultado_control_calidad: "OTRO",
    }).success,
    false,
  );
  for (const cantidad of [0, -2, 1.5]) {
    assert.equal(
      ReclasificarDevueltoSchema.safeParse({
        variante_sku_id: variante,
        deposito_id: deposito,
        cantidad,
        resultado_control_calidad: "APTO",
      }).success,
      false,
    );
  }
});

test("RechazarSolicitudSchema exige rechazada_motivo no vacío", () => {
  assert.equal(
    RechazarSolicitudSchema.safeParse({ rechazada_motivo: "La documentación del RMA es inválida" }).success,
    true,
  );
  assert.equal(RechazarSolicitudSchema.safeParse({}).success, false);
  assert.equal(RechazarSolicitudSchema.safeParse({ rechazada_motivo: "  " }).success, false);
});

test("SolicitudReclasificacionIdSchema valida el UUID del segmento [id]", () => {
  assert.equal(SolicitudReclasificacionIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(SolicitudReclasificacionIdSchema.safeParse(variante).success, true);
});

// ── Umbral ────────────────────────────────────────────────────────────────────

test("el umbral de baja/merma es 5 y superaUmbral separa 4/5/6 correctamente", () => {
  assert.equal(UMBRAL_BAJA_MERMA_UNIDADES, 5);
  assert.equal(superaUmbral(4), false);
  assert.equal(superaUmbral(5), false);
  assert.equal(superaUmbral(6), true);
});

// ── Contrato del service (source asserts, molde reserva.test.ts) ─────────────

test("reclasificarDevuelto valida precondición DEVUELTO con orderBy anidado por created_at desc", () => {
  const bloque = sliceReclasificarDevuelto(leerServicio());
  assert.match(bloque, /estado_destino: "DEVUELTO"/);
  assert.match(bloque, /deposito_destino_id: input\.deposito_id/);
  assert.match(bloque, /orderBy: \{ movimiento: \{ created_at: "desc" \} \}/);
  assert.match(bloque, /new ServiceError\(\s*"ESTADO_INVALIDO_PARA_RECLASIFICACION"/);
});

test("reclasificarDevuelto valida variante y depósito activos con 404 y usa superaUmbral para bifurcar", () => {
  const bloque = sliceReclasificarDevuelto(leerServicio());
  assert.match(bloque, /new ServiceError\("VARIANTE_NO_ENCONTRADA"/);
  assert.match(bloque, /new ServiceError\("DEPOSITO_NO_ENCONTRADO"/);
  assert.match(bloque, /if \(!superaUmbral\(input\.cantidad\)\)/);
});

test("la vía directa crea MovimientoStock AJUSTE con item DEVUELTO→destino y motivo/rma_id opcionales", () => {
  const bloque = sliceReclasificarDevuelto(leerServicio());
  assert.match(bloque, /tipo_movimiento: "AJUSTE"/);
  assert.match(bloque, /estado_origen: "DEVUELTO"/);
  assert.match(bloque, /estado_destino: estadoDestino/);
  assert.match(bloque, /motivo: input\.motivo \?\? null/);
  assert.match(bloque, /rma_id: input\.rma_id \?\? null/);
});

test("StockDeposito se incrementa SOLO cuando APTO, con updateMany condicionado y STOCK_DEPOSITO_NO_ENCONTRADO", () => {
  const bloque = sliceReclasificarDevuelto(leerServicio());
  assert.match(bloque, /if \(estadoDestino === "DISPONIBLE"\)/);
  assert.match(bloque, /cantidad: \{ increment: input\.cantidad \}/);
  assert.match(bloque, /incremento\.count === 0/);
  assert.match(bloque, /new ServiceError\(\s*"STOCK_DEPOSITO_NO_ENCONTRADO"/);
});

test("la vía sobre umbral crea SOLO la solicitud PENDIENTE_APROBACION sin tocar stock", () => {
  const bloque = sliceReclasificarDevuelto(leerServicio());
  assert.match(bloque, /tx\.reclasificacionSolicitud\.create\(\{/);
  assert.match(bloque, /estado: "PENDIENTE_APROBACION"/);
  assert.match(bloque, /solicitada_por_id: usuarioId/);
  // En la vía solicitud no hay movimiento ni incremento de stock.
  const bloqueSolicitud = bloque.slice(bloque.indexOf("tx.reclasificacionSolicitud.create"));
  assert.doesNotMatch(bloqueSolicitud, /tx\.movimientoStock\.create/);
  assert.doesNotMatch(bloqueSolicitud, /increment:/);
});

test("los eventos de reclasificación se emiten fuera de prisma.$transaction (regla spec §4)", () => {
  const bloque = sliceReclasificarDevuelto(leerServicio());
  const tx = bloque.indexOf("await prisma.$transaction");
  const emitDevuelto = bloque.indexOf('domainEventBus.emit("stock:reclasificacion_devuelto"');
  const emitSolicitud = bloque.indexOf('domainEventBus.emit("stock:reclasificacion_solicitud_creada"');
  assert.ok(tx > -1 && emitDevuelto > tx);
  assert.ok(tx > -1 && emitSolicitud > tx);
});

test("el service NUNCA escribe AuditLog directo (única vía: listener vía eventos)", () => {
  const fuente = leerServicio();
  assert.doesNotMatch(fuente, /registrarAuditLog\(/);
  assert.doesNotMatch(fuente, /auditLog\./);
});

test("aprobarSolicitud exige solicitud pendiente, cierra con updateMany condicionado y aplica BAJA_MERMA", () => {
  const bloque = sliceAprobarSolicitud(leerServicio());
  assert.match(bloque, /new ServiceError\("SOLICITUD_NO_ENCONTRADA"/);
  assert.match(bloque, /estado: "PENDIENTE_APROBACION"/);
  assert.match(bloque, /tx\.reclasificacionSolicitud\.updateMany\(\{/);
  assert.match(bloque, /new ServiceError\("SOLICITUD_NO_PENDIENTE"/);
  assert.match(bloque, /estado: "APROBADA"/);
  assert.match(bloque, /aprobada_por_id: adminId/);
  assert.match(bloque, /estado_destino: "BAJA_MERMA"/);
  assert.match(bloque, /comprobante_referencia: `RECLASIFICACION-SOLICITUD-\$\{solicitud\.id\}`/);
  // La aprobación NUNCA incrementa stock (siempre NO_APTO → BAJA_MERMA).
  assert.doesNotMatch(bloque, /increment:/);
});

test("aprobarSolicitud emite ambos eventos post-COMMIT", () => {
  const bloque = sliceAprobarSolicitud(leerServicio());
  const tx = bloque.indexOf("await prisma.$transaction");
  const emitAprobada = bloque.indexOf('domainEventBus.emit("stock:reclasificacion_solicitud_aprobada"');
  const emitDevuelto = bloque.indexOf('domainEventBus.emit("stock:reclasificacion_devuelto"');
  assert.ok(tx > -1 && emitAprobada > tx);
  assert.ok(tx > -1 && emitDevuelto > tx);
});

test("rechazarSolicitud exige motivo, marca RECHAZADA con updateMany condicionado y emite post-COMMIT", () => {
  const bloque = sliceRechazarSolicitud(leerServicio());
  assert.match(bloque, /new ServiceError\("SOLICITUD_RECHAZADA_MOTIVO_REQUERIDO"/);
  assert.match(bloque, /new ServiceError\("SOLICITUD_NO_ENCONTRADA"/);
  assert.match(bloque, /estado: "RECHAZADA"/);
  assert.match(bloque, /rechazada_motivo: rechazadaMotivo/);
  const tx = bloque.indexOf("await prisma.$transaction");
  const emitRechazada = bloque.indexOf('domainEventBus.emit("stock:reclasificacion_solicitud_rechazada"');
  assert.ok(tx > -1 && emitRechazada > tx);
  assert.doesNotMatch(bloque, /tx\.movimientoStock\.create/);
});

test("listarSolicitudesPendientes filtra PENDIENTE_APROBACION y resuelve variante y depósito", () => {
  const fuente = leerServicio();
  const bloque = fuente.slice(fuente.indexOf("export async function listarSolicitudesPendientes"));
  assert.match(bloque, /estado: "PENDIENTE_APROBACION"/);
  assert.match(bloque, /is_active: true, deleted_at: null/);
  assert.match(bloque, /variante_sku: \{/);
  assert.match(bloque, /deposito: \{ select: \{ nombre: true \} \}/);
});

test("listarUnidadesDevueltas filtra DEVUELTO con filtros variante/depósito y sin paginación", () => {
  const fuente = leerServicio();
  const bloque = fuente.slice(fuente.indexOf("export async function listarUnidadesDevueltas"));
  assert.match(bloque, /estado_destino: "DEVUELTO"/);
  assert.match(bloque, /deposito_destino_id: filtros\.deposito_id/);
  assert.match(bloque, /variante_sku_id: filtros\.variante_sku_id/);
  assert.doesNotMatch(bloque, /skip:/);
  assert.doesNotMatch(bloque, /take:/);
});

// ── Listener de auditoría (Módulo D) ─────────────────────────────────────────

test("el listener de auditoría registra los 4 eventos HU-A9 con acciones y tablas correctas", () => {
  const listener = readFileSync(
    new URL("../../events/listeners/audit-log.listener.ts", import.meta.url),
    "utf8",
  );
  assert.match(listener, /domainEventBus\.on\("stock:reclasificacion_devuelto"/);
  assert.match(listener, /domainEventBus\.on\("stock:reclasificacion_solicitud_creada"/);
  assert.match(listener, /domainEventBus\.on\("stock:reclasificacion_solicitud_aprobada"/);
  assert.match(listener, /domainEventBus\.on\("stock:reclasificacion_solicitud_rechazada"/);
  assert.match(listener, /accion: "RECLASIFICACION"/);
  assert.match(listener, /accion: "SOLICITUD_CREADA"/);
  assert.match(listener, /accion: "SOLICITUD_APROBADA"/);
  assert.match(listener, /accion: "SOLICITUD_RECHAZADA"/);
  assert.match(listener, /tabla_afectada: "movimientos_stock"/);
  assert.match(listener, /tabla_afectada: "reclasificacion_solicitudes"/);
  assert.match(listener, /ip: "internal-event"/);
});

// ── Eventos ───────────────────────────────────────────────────────────────────

test("event-types.ts tipa los 4 eventos HU-A9 en DomainEventMap", () => {
  const eventos = readFileSync(
    new URL("../../events/event-types.ts", import.meta.url),
    "utf8",
  );
  assert.match(eventos, /"stock:reclasificacion_devuelto": ReclasificacionDevueltoPayload/);
  assert.match(eventos, /"stock:reclasificacion_solicitud_creada": ReclasificacionSolicitudCreadaPayload/);
  assert.match(eventos, /"stock:reclasificacion_solicitud_aprobada": ReclasificacionSolicitudAprobadaPayload/);
  assert.match(eventos, /"stock:reclasificacion_solicitud_rechazada": ReclasificacionSolicitudRechazadaPayload/);
  assert.match(eventos, /estado_origen: "DEVUELTO"/);
  assert.match(eventos, /estado_destino: "DISPONIBLE" \| "BAJA_MERMA"/);
});