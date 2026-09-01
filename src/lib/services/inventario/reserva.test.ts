import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CrearReservaSchema,
  ConfirmarReservaSchema,
  ReservaIdSchema,
} from "../../schemas/inventario.schema.ts";

const variante = "11111111-1111-4111-8111-111111111111";
const deposito = "22222222-2222-4222-8222-222222222222";
const venta = "44444444-4444-4444-8444-444444444444";

// ── Schemas ───────────────────────────────────────────────────────────────────

test("CrearReservaSchema acepta un congelamiento válido con cada uno de los 3 orígenes", () => {
  for (const origen_reserva of ["SENIA", "LICITACION", "PEDIDO_INSTITUCIONAL"]) {
    assert.equal(
      CrearReservaSchema.safeParse({
        variante_sku_id: variante,
        deposito_id: deposito,
        cantidad: 3,
        origen_reserva,
      }).success,
      true,
    );
  }
});

test("CrearReservaSchema rechaza un origen fuera del enum", () => {
  assert.equal(
    CrearReservaSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 3,
      origen_reserva: "OTRO",
    }).success,
    false,
  );
});

test("CrearReservaSchema rechaza cantidad cero, negativa o fraccionaria", () => {
  for (const cantidad of [0, -2, 1.5]) {
    assert.equal(
      CrearReservaSchema.safeParse({
        variante_sku_id: variante,
        deposito_id: deposito,
        cantidad,
        origen_reserva: "SENIA",
      }).success,
      false,
    );
  }
});

test("CrearReservaSchema acepta ttl_horas explícito positivo y rechaza cero", () => {
  assert.equal(
    CrearReservaSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
      origen_reserva: "SENIA",
      ttl_horas: 2,
    }).success,
    true,
  );
  assert.equal(
    CrearReservaSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
      origen_reserva: "SENIA",
      ttl_horas: 0,
    }).success,
    false,
  );
});

test("ConfirmarReservaSchema exige venta_id con formato UUID", () => {
  assert.equal(ConfirmarReservaSchema.safeParse({ venta_id: venta }).success, true);
  assert.equal(ConfirmarReservaSchema.safeParse({ venta_id: "no-es-uuid" }).success, false);
  assert.equal(ConfirmarReservaSchema.safeParse({}).success, false);
});

test("ReservaIdSchema valida el UUID del segmento [id]", () => {
  assert.equal(ReservaIdSchema.safeParse("no-es-uuid").success, false);
  assert.equal(ReservaIdSchema.safeParse(variante).success, true);
});

// ── Contrato del service (asserts sobre el texto fuente, molde transferencia.test.ts) ─

test("crearReserva usa decremento atómico condicionado y aborta con STOCK_INSUFICIENTE", () => {
  const fuente = readFileSync(new URL("./reserva.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /cantidad:\s*\{ gte: input\.cantidad \}/);
  assert.match(fuente, /if \(decremento\.count === 0\)/);
  assert.match(fuente, /STOCK_INSUFICIENTE/);
});

test("el congelamiento crea MovimientoStock AJUSTE DISPONIBLE→RESERVADO y no dispara alerta de umbral", () => {
  const fuente = readFileSync(new URL("./reserva.service.ts", import.meta.url), "utf8");
  const inicio = fuente.indexOf("export async function crearReserva");
  const fin = fuente.indexOf("export async function confirmarReservaPorVenta");
  const bloque = fuente.slice(inicio, fin);
  assert.match(bloque, /tipo_movimiento: "AJUSTE"/);
  assert.match(bloque, /estado_origen: "DISPONIBLE"[\s\S]*estado_destino: "RESERVADO"/);
  // No emite la alerta de umbral crítico ni invoca el decremento con alerta
  // (mismo precedente que crearTransferencia). Se chequean las formas de
  // llamada/emisión reales, no las menciones en el docstring.
  assert.doesNotMatch(fuente, /emit\(\s*["']stock:umbral_critico_alcanzado["']/);
  assert.doesNotMatch(bloque, /await decrementarStockConAlerta\(/);
});

test("la liberación por venta usa EGRESO, cierra la reserva, no reincrementa stock y referencia venta_id", () => {
  const fuente = readFileSync(new URL("./reserva.service.ts", import.meta.url), "utf8");
  const inicio = fuente.indexOf("export async function confirmarReservaPorVenta");
  const fin = fuente.indexOf("export async function liberarReservasVencidas");
  const bloque = fuente.slice(inicio, fin);
  assert.match(bloque, /tipo_movimiento: "EGRESO"/);
  assert.match(bloque, /estado_origen: "RESERVADO"[\s\S]*estado_destino: "VENDIDO"/);
  assert.match(bloque, /venta_id: ventaId/);
  assert.match(bloque, /RESERVA_NO_ACTIVA/);
  assert.doesNotMatch(bloque, /increment:/);
});

test("la liberación por TTL usa INGRESO compensatorio RESERVADO→DISPONIBLE con la limitación documentada", () => {
  const fuente = readFileSync(new URL("./reserva.service.ts", import.meta.url), "utf8");
  const bloque = fuente.slice(fuente.indexOf("export async function liberarReservasVencidas"));
  assert.match(bloque, /tipo_movimiento: "INGRESO"/);
  assert.match(bloque, /estado_origen: "RESERVADO"[\s\S]*estado_destino: "DISPONIBLE"/);
  assert.match(bloque, /increment: reserva\.cantidad/);
  assert.match(
    bloque,
    /LIMITACIÓN CONOCIDA: cron aplica 72h fijo por origen, no respeta ttl_horas explícito de e-commerce — resolver al implementar HU-E1/,
  );
});

test("los eventos de dominio se emiten fuera de prisma.$transaction (regla de emisión spec §4)", () => {
  const fuente = readFileSync(new URL("./reserva.service.ts", import.meta.url), "utf8");
  const primeraTx = fuente.indexOf("await prisma.$transaction");
  const emitCongelada = fuente.indexOf('domainEventBus.emit("stock:reserva_congelada"');
  assert.ok(primeraTx > -1 && emitCongelada > primeraTx);
  assert.match(fuente, /domainEventBus\.emit\("stock:reserva_liberada"/);
});

test("el TTL por defecto es 72h para los 3 orígenes y ttl_horas explícito lo sobreescribe", () => {
  const fuente = readFileSync(new URL("./reserva.service.ts", import.meta.url), "utf8");
  assert.match(fuente, /TTL_RESERVA_DEFAULT_HORAS = 72/);
  assert.match(fuente, /return ttlHorasInput \?\? TTL_POR_ORIGEN\[origen\]/);
});

// ── Cron ──────────────────────────────────────────────────────────────────────

test("el cron de reservas vencidas expone POST, no GET, y delega en el service", () => {
  const ruta = readFileSync(
    new URL("../../../app/api/cron/check-pruebas-vencidas/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(ruta, /export async function POST/);
  assert.doesNotMatch(ruta, /export async function GET/);
  assert.match(ruta, /liberarReservasVencidas/);
  assert.match(ruta, /Bearer \$\{cronSecret\}/);
});

// ── RBAC / seed ───────────────────────────────────────────────────────────────

test("el seed crea los permisos granulares de Reserva y los asigna a Encargado y Administrador", () => {
  const seed = readFileSync(new URL("../../../../prisma/seed.ts", import.meta.url), "utf8");
  assert.match(seed, /codigo: "inventario:reservar_stock"/);
  assert.match(seed, /codigo: "inventario:confirmar_reserva"/);
  assert.match(
    seed,
    /for \(const permiso of \[permisoTransferirStock, permisoConfirmarRecepcion, permisoReservarStock, permisoConfirmarReserva\]\)/,
  );
  assert.match(seed, /Pendiente: asignar a rol de Módulo B\/E cuando se implemente HU-B3\/HU-E1/);
});

test("las rutas de Reserva quedan gateadas por withPermission con el código correcto", () => {
  const congelamiento = readFileSync(
    new URL("../../../app/api/inventario/reservas/route.ts", import.meta.url),
    "utf8",
  );
  const confirmar = readFileSync(
    new URL("../../../app/api/inventario/reservas/[id]/confirmar/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(congelamiento, /withPermission\("inventario:reservar_stock"/);
  assert.match(confirmar, /withPermission\(\s*"inventario:confirmar_reserva"/);
});

// ── Auditoría (Módulo D) ──────────────────────────────────────────────────────

test("el listener de auditoría cubre los dos eventos de Reserva sobre la tabla reservas", () => {
  const listener = readFileSync(
    new URL("../../events/listeners/audit-log.listener.ts", import.meta.url),
    "utf8",
  );
  assert.match(listener, /domainEventBus\.on\("stock:reserva_congelada"/);
  assert.match(listener, /domainEventBus\.on\("stock:reserva_liberada"/);
  assert.match(listener, /accion: "RESERVA_CONGELADA"/);
  assert.match(listener, /accion: "RESERVA_LIBERADA"/);
  assert.match(listener, /tabla_afectada: "reservas"/);
});
