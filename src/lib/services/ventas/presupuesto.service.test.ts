import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `presupuesto.service.ts` (mismo patrón que
 * `reserva.test.ts` / `proveedor.service.test.ts` — sin mock de prisma, el
 * archivo no puede importarse en Node por `import "server-only"`).
 *
 * Hallazgo de relevamiento (task_HU-B3_cotizacion_presupuesto.md, Paso 1,
 * confirmado por el usuario): los usuarios seed `cajero.seed` /
 * `supervisor.ventas.seed` no tienen ningún Rol asignado, así que un login
 * real como esos usuarios recibiría 403 de `withPermission`. Estos tests
 * verifican el CONTRATO del servicio a nivel de código fuente, sin pasar por
 * sesión/HTTP — complementan (no reemplazan) la verificación end-to-end con
 * sesión real, que queda documentada como bloqueante conocido en el reporte
 * final de testing.
 */

const fuente = readFileSync(new URL("./presupuesto.service.ts", import.meta.url), "utf8");

const sliceCrearPresupuesto = fuente.slice(
  fuente.indexOf("export async function crearPresupuesto"),
  fuente.indexOf("// ──", fuente.indexOf("export async function crearPresupuesto") + 10),
);

const sliceAceptarPresupuesto = fuente.slice(
  fuente.indexOf("export async function aceptarPresupuesto"),
  fuente.indexOf(
    "// ──",
    fuente.indexOf("export async function aceptarPresupuesto") + 10,
  ),
);

// ── Permisos (contrato compartido con el seed y las rutas) ──────────────────

test("los permisos exportados coinciden literalmente con los códigos sembrados en el seed", () => {
  assert.match(fuente, /PERMISO_VENTAS_EMITIR_COTIZACION = "ventas:emitir_cotizacion"/);
  assert.match(fuente, /PERMISO_VENTAS_LEER = "ventas:leer"/);

  const seed = readFileSync(new URL("../../../../prisma/seed.ts", import.meta.url), "utf8");
  assert.match(seed, /"ventas:emitir_cotizacion"/);
  assert.match(seed, /"ventas:leer"/);
});

test("las rutas de Presupuesto quedan gateadas por withPermission con ventas:emitir_cotizacion", () => {
  const rutaAlta = readFileSync(
    new URL("../../../app/api/ventas/presupuestos/route.ts", import.meta.url),
    "utf8",
  );
  const rutaAceptar = readFileSync(
    new URL("../../../app/api/ventas/presupuestos/[id]/aceptar/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(rutaAlta, /withPermission\(\s*PERMISO_VENTAS_EMITIR_COTIZACION/);
  assert.match(rutaAceptar, /withPermission\(\s*PERMISO_VENTAS_EMITIR_COTIZACION/);
});

// ── crearPresupuesto() — exclusividad de Módulo A sobre stock (spec §3.2) ───

test("crearPresupuesto valida el cliente ANTES de congelar cualquier reserva", () => {
  const idxCliente = sliceCrearPresupuesto.indexOf("CLIENTE_NO_ENCONTRADO");
  const idxCrearReserva = sliceCrearPresupuesto.indexOf("await crearReserva(");
  assert.ok(idxCliente > -1 && idxCrearReserva > -1);
  assert.ok(idxCliente < idxCrearReserva);
});

test("crearPresupuesto congela stock invocando crearReserva() de Módulo A por cada ítem — nunca prisma.reserva.* ni stockDeposito.updateMany directo", () => {
  assert.match(sliceCrearPresupuesto, /for \(const item of input\.items\)/);
  assert.match(sliceCrearPresupuesto, /await crearReserva\(/);
  assert.doesNotMatch(sliceCrearPresupuesto, /tx\.reserva\.create/);
  assert.doesNotMatch(sliceCrearPresupuesto, /prisma\.reserva\.create/);
  assert.doesNotMatch(sliceCrearPresupuesto, /stockDeposito\.updateMany/);
});

test("crearPresupuesto deriva ttl_horas de vigencia_dias (spec §2.3) y lo pasa a crearReserva junto con origen_reserva", () => {
  assert.match(sliceCrearPresupuesto, /const ttlHoras = input\.vigencia_dias \* 24/);
  assert.match(sliceCrearPresupuesto, /ttl_horas: ttlHoras/);
  assert.match(sliceCrearPresupuesto, /origen_reserva: input\.origen_reserva/);
});

test("crearPresupuesto persiste cada PresupuestoItem referenciando la Reserva ya congelada (reserva_id), dentro de una única $transaction", () => {
  assert.match(sliceCrearPresupuesto, /prisma\.\$transaction\(async \(tx\) => \{/);
  assert.match(sliceCrearPresupuesto, /tx\.presupuesto\.create\(/);
  assert.match(sliceCrearPresupuesto, /reserva_id: reservaIdPorIndice\[indice\]/);
});

test("crearPresupuesto emite venta:presupuesto_emitido después de que la $transaction resuelve (regla de emisión post-COMMIT)", () => {
  const tx = sliceCrearPresupuesto.indexOf("await prisma.$transaction");
  const emit = sliceCrearPresupuesto.indexOf('domainEventBus.emit("venta:presupuesto_emitido"');
  assert.ok(tx > -1 && emit > tx);
});

test("crearPresupuesto documenta que una falla parcial NO revierte reservas ya congeladas (sin liberación propia, spec §3.2)", () => {
  assert.match(
    fuente,
    /Módulo B no implementa liberación de stock propia bajo\s*\n?\s*\* ninguna circunstancia \(spec §3\.2\)/,
  );
});

// ── aceptarPresupuesto() — reutilización de Reserva, sin congelar de nuevo ──

test("aceptarPresupuesto reutiliza la MISMA reserva_id del PresupuestoItem — nunca invoca crearReserva()", () => {
  assert.match(sliceAceptarPresupuesto, /reserva_id: it\.reserva_id/);
  assert.doesNotMatch(sliceAceptarPresupuesto, /crearReserva\(/);
});

test("aceptarPresupuesto aplica la transición perezosa de vencimiento antes de aceptar y rechaza con PRESUPUESTO_VENCIDO", () => {
  assert.match(sliceAceptarPresupuesto, /aplicarVencimientoSiCorresponde\(actual\)/);
  assert.match(sliceAceptarPresupuesto, /new ServiceError\(\s*"PRESUPUESTO_VENCIDO"/);
});

test("aceptarPresupuesto rechaza cualquier estado origen distinto de EMITIDO con TRANSICION_INVALIDA (409)", () => {
  assert.match(sliceAceptarPresupuesto, /new ServiceError\(\s*\n?\s*"TRANSICION_INVALIDA"/);
});

test("aceptarPresupuesto se defiende de doble aceptación concurrente vía el @unique de presupuesto_origen_id (P2002), sin reintentar con otro numero_venta", () => {
  assert.match(sliceAceptarPresupuesto, /presupuesto_origen_id: presupuestoId/);
  assert.match(sliceAceptarPresupuesto, /targetStr\.includes\("presupuesto_origen_id"\)/);
  assert.match(sliceAceptarPresupuesto, /PRESUPUESTO_YA_CONVERTIDO/);
});

test("aceptarPresupuesto reintenta numero_venta ante P2002 hasta MAX_INTENTOS_NUMERO_VENTA, nunca en colisión de presupuesto_origen_id", () => {
  assert.match(sliceAceptarPresupuesto, /const MAX_INTENTOS_NUMERO_VENTA = 3/);
  assert.match(
    sliceAceptarPresupuesto,
    /targetStr\.includes\("numero_venta"\) && intento < MAX_INTENTOS_NUMERO_VENTA/,
  );
});

test("aceptarPresupuesto emite venta:presupuesto_aceptado después del COMMIT", () => {
  const tx = sliceAceptarPresupuesto.indexOf("await prisma.$transaction");
  const emit = sliceAceptarPresupuesto.indexOf('domainEventBus.emit("venta:presupuesto_aceptado"');
  assert.ok(tx > -1 && emit > tx);
});

// ── Transición perezosa EMITIDO → VENCIDO (spec §2.3/§3.1) ──────────────────

test("aplicarVencimientoSiCorresponde nunca toca Reserva ni StockDeposito — es baja lógica pura sobre Presupuesto", () => {
  const bloque = fuente.slice(
    fuente.indexOf("async function aplicarVencimientoSiCorresponde"),
    fuente.indexOf("export function calcularEstadoEfectivo"),
  );
  assert.match(bloque, /prisma\.presupuesto\.updateMany/);
  assert.doesNotMatch(bloque, /\.reserva\./);
  assert.doesNotMatch(bloque, /stockDeposito/i);
  assert.match(bloque, /estado: "VENCIDO"/);
  assert.match(bloque, /is_active: false/);
});

test("calcularEstadoEfectivo (listado) es una función pura, sin escritura a prisma", () => {
  const bloque = fuente.slice(
    fuente.indexOf("export function calcularEstadoEfectivo"),
    fuente.indexOf("// ──", fuente.indexOf("export function calcularEstadoEfectivo") + 10),
  );
  assert.doesNotMatch(bloque, /prisma\./);
  assert.doesNotMatch(bloque, /await /);
});

// ── Selectores de la UI ──────────────────────────────────────────────────────

test("listarClientesParaSelector filtra clientes activos, no fusionados y no eliminados", () => {
  const bloque = fuente.slice(fuente.indexOf("export async function listarClientesParaSelector"));
  assert.match(bloque, /is_active: true, deleted_at: null, fusionado_en_id: null/);
});

test("listarVariantesParaCotizacion no importa el selector de Módulo H (evita acoplar Ventas a Compras)", () => {
  assert.doesNotMatch(fuente, /from "@\/lib\/services\/proveedores\/orden-compra\.service"/);
});
