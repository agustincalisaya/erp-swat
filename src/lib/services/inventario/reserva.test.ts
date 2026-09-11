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
    /for \(const permiso of \[permisoTransferirStock, permisoConfirmarRecepcion, permisoReservarStock, permisoConfirmarReserva, permisoMovimientosLeerHistorico\]\)/,
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

// ── Ampliación HU-A10 (task_testing_HU-A10.md §1) — tests A–L ──────────────────
// Mismo molde que los 16 de arriba: asserts sobre el texto fuente del service
// (no se puede importar `reserva.service.ts` en Node por `import "server-only"`)
// + safeParse de los schemas Zod.

const leerServicio = () =>
  readFileSync(new URL("./reserva.service.ts", import.meta.url), "utf8");

const sliceCrearReserva = (fuente: string) =>
  fuente.slice(
    fuente.indexOf("export async function crearReserva"),
    fuente.indexOf("export async function confirmarReservaPorVenta"),
  );

const sliceConfirmarReserva = (fuente: string) =>
  fuente.slice(
    fuente.indexOf("export async function confirmarReservaPorVenta"),
    fuente.indexOf("export async function liberarReservasVencidas"),
  );

const sliceLiberarVencidas = (fuente: string) =>
  fuente.slice(fuente.indexOf("export async function liberarReservasVencidas"));

// crearReserva() ──────────────────────────────────────────────────────────────

test("A — crearReserva persiste origen_reserva y la Reserva nace con fecha_fin_reserva null", () => {
  const bloque = sliceCrearReserva(leerServicio());
  assert.match(bloque, /tx\.reserva\.create\(\{/);
  assert.match(bloque, /origen_reserva: input\.origen_reserva/);
  assert.match(bloque, /fecha_fin_reserva: null/);
});

test("B — crearReserva resuelve el TTL con resolverTtlHoras(origen, ttl_horas) y lo devuelve en ttl_horas", () => {
  const fuente = leerServicio();
  assert.match(
    fuente,
    /const ttlHoras = resolverTtlHoras\(input\.origen_reserva, input\.ttl_horas\)/,
  );
  assert.match(fuente, /ttl_horas: ttlHoras/);
});

test("C — TTL_POR_ORIGEN cubre los 3 orígenes contra la constante 72h, sin número mágico", () => {
  const fuente = leerServicio();
  const inicio = fuente.indexOf("const TTL_POR_ORIGEN");
  const bloque = fuente.slice(inicio, fuente.indexOf("};", inicio) + 2);
  assert.match(bloque, /SENIA: TTL_RESERVA_DEFAULT_HORAS/);
  assert.match(bloque, /LICITACION: TTL_RESERVA_DEFAULT_HORAS/);
  assert.match(bloque, /PEDIDO_INSTITUCIONAL: TTL_RESERVA_DEFAULT_HORAS/);
  assert.doesNotMatch(bloque, /:\s*72\b/);
});

test("D — el MovimientoStock del congelamiento referencia la Reserva vía comprobante RESERVA-<id>", () => {
  const bloque = sliceCrearReserva(leerServicio());
  assert.match(bloque, /comprobante_referencia: `RESERVA-\$\{creada\.id\}`/);
});

// confirmarReservaPorVenta() ──────────────────────────────────────────────────

test("E — el cierre por venta usa updateMany condicionado (id + is_active + deleted_at + fecha_fin_reserva null), no update por PK", () => {
  const bloque = sliceConfirmarReserva(leerServicio());
  assert.match(
    bloque,
    /tx\.reserva\.updateMany\(\{\s*where: \{ id: reservaId, is_active: true, deleted_at: null, fecha_fin_reserva: null \}/,
  );
  assert.doesNotMatch(bloque, /tx\.reserva\.update\(\{/);
});

test("F — confirmarReservaPorVenta distingue RESERVA_INACTIVA (baja lógica) de RESERVA_NO_ACTIVA (ya cerrada) y no regresó a AJUSTE", () => {
  const bloque = sliceConfirmarReserva(leerServicio());
  assert.match(bloque, /if \(!actual\.is_active \|\| actual\.deleted_at\)/);
  assert.match(bloque, /new ServiceError\("RESERVA_INACTIVA"/);
  assert.match(bloque, /if \(cambio\.count === 0\)/);
  assert.match(bloque, /new ServiceError\("RESERVA_NO_ACTIVA"/);
  assert.doesNotMatch(bloque, /tipo_movimiento: "AJUSTE"/);
});

test("G — confirmarReservaPorVenta emite stock:reserva_liberada con motivo_liberacion VENTA, tras abrir la $transaction", () => {
  const bloque = sliceConfirmarReserva(leerServicio());
  const tx = bloque.indexOf("await prisma.$transaction");
  const emit = bloque.indexOf('domainEventBus.emit("stock:reserva_liberada"');
  assert.ok(tx > -1 && emit > tx);
  assert.match(bloque, /motivo_liberacion: "VENTA"/);
});

// liberarReservasVencidas() ───────────────────────────────────────────────────

test("H — liberarReservasVencidas selecciona sólo reservas activas, sin cierre y anteriores al umbral", () => {
  const bloque = sliceLiberarVencidas(leerServicio());
  assert.match(
    bloque,
    /prisma\.reserva\.findMany\(\{\s*where: \{\s*is_active: true,\s*deleted_at: null,\s*fecha_fin_reserva: null,\s*fecha_inicio_reserva: \{ lt: umbral \},/,
  );
});

test("I — el umbral del cron se calcula restando TTL_RESERVA_DEFAULT_HORAS y el bloque no regresó a AJUSTE", () => {
  const bloque = sliceLiberarVencidas(leerServicio());
  assert.match(bloque, /const ttlHoras = TTL_RESERVA_DEFAULT_HORAS/);
  assert.match(bloque, /umbral\.setHours\(umbral\.getHours\(\) - ttlHoras\)/);
  assert.doesNotMatch(bloque, /tipo_movimiento: "AJUSTE"/);
});

test("J — se emite un stock:reserva_liberada con motivo TTL_VENCIDO por cada reserva liberada, tras el loop transaccional", () => {
  const bloque = sliceLiberarVencidas(leerServicio());
  const loopTx = bloque.indexOf("for (const reserva of vencidas)");
  const loopEmit = bloque.indexOf("for (const reserva of liberadas)");
  assert.ok(loopTx > -1 && loopEmit > loopTx);
  const bloqueEmit = bloque.slice(loopEmit);
  assert.match(bloqueEmit, /domainEventBus\.emit\("stock:reserva_liberada", \{/);
  assert.match(bloqueEmit, /motivo_liberacion: "TTL_VENCIDO"/);
});

test("K — cada $transaction del cron va dentro de un try/catch por reserva: una falla no aborta el resto", () => {
  const bloque = sliceLiberarVencidas(leerServicio());
  const cuerpoLoop = bloque.slice(
    bloque.indexOf("for (const reserva of vencidas)"),
    bloque.indexOf("for (const reserva of liberadas)"),
  );
  assert.match(cuerpoLoop, /try \{[\s\S]*await prisma\.\$transaction\([\s\S]*\} catch \(error\) \{/);
  assert.match(cuerpoLoop, /console\.error\(`\[liberarReservasVencidas\] Error al liberar reserva/);
});

// Schemas Zod ─────────────────────────────────────────────────────────────────

test("L — CrearReservaSchema rechaza UUIDs inválidos y la ausencia de origen_reserva", () => {
  assert.equal(
    CrearReservaSchema.safeParse({
      variante_sku_id: "no-es-uuid",
      deposito_id: deposito,
      cantidad: 1,
      origen_reserva: "SENIA",
    }).success,
    false,
  );
  assert.equal(
    CrearReservaSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: "no-es-uuid",
      cantidad: 1,
      origen_reserva: "SENIA",
    }).success,
    false,
  );
  assert.equal(
    CrearReservaSchema.safeParse({
      variante_sku_id: variante,
      deposito_id: deposito,
      cantidad: 1,
    }).success,
    false,
  );
});
