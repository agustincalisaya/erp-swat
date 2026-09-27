import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests puros (sin I/O) de las dos decisiones agregadas a
 * `lista-precios.service.ts` para la UI "Lista de Precios":
 *  - `calcularResultadoPreview` — MISMA decisión que
 *    `publicarNuevaVersionListaPrecio` (ítems sin precio previo excluidos
 *    del cálculo, >UMBRAL_VARIACION_CRITICA_PORCENTUAL=20 → requiere_aprobacion).
 *  - `derivarEstadoListaPrecioVersion` — estado agregado de una versión para
 *    el historial (VIGENTE / HISTORICA / PENDIENTE_APROBACION / FUTURA).
 *
 * Corren bajo el script `test` principal (`node --experimental-strip-types
 * --test`), por eso el import es relativo con extensión explícita — mismo
 * patrón que `evaluacion.calculo.test.ts` / `lista-precios.schema.test.ts`.
 * Importa de `lista-precios.calculo.ts` (módulo PURO, sin `server-only`),
 * NO de `lista-precios.service.ts` (que sí importa `server-only` y revienta
 * bajo el script `test` plano — ver docstring de `lista-precios.calculo.ts`).
 */
import {
  calcularResultadoPreview,
  derivarEstadoListaPrecioVersion,
} from "./lista-precios.calculo.ts";

const SKU_A = "11111111-1111-4111-8111-111111111111";
const SKU_B = "22222222-2222-4222-8222-222222222222";
const SKU_C = "33333333-3333-4333-8333-333333333333";

// ──────────────────────────────────────────────────────────────────────────────
// calcularResultadoPreview
// ──────────────────────────────────────────────────────────────────────────────

test("calcularResultadoPreview: ítem sin precio previo se excluye del cálculo de variación (sin 0%/100% artificial)", () => {
  const resultado = calcularResultadoPreview([
    { variante_sku_id: SKU_A, precio_anterior: null, precio_nuevo: 1000 },
  ]);
  assert.equal(resultado.items[0].variacion_porcentual, null);
  assert.equal(resultado.variacion_porcentual_maxima, 0);
  assert.equal(resultado.requiere_aprobacion, false);
});

test("calcularResultadoPreview: variación dentro del umbral (<=20%) no requiere aprobación", () => {
  const resultado = calcularResultadoPreview([
    { variante_sku_id: SKU_A, precio_anterior: 1000, precio_nuevo: 1150 }, // +15%
  ]);
  assert.equal(resultado.items[0].variacion_porcentual, 15);
  assert.equal(resultado.variacion_porcentual_maxima, 15);
  assert.equal(resultado.requiere_aprobacion, false);
  assert.equal(resultado.umbral, 20);
});

test("calcularResultadoPreview: variación >20% (baja o suba) requiere aprobación", () => {
  const resultado = calcularResultadoPreview([
    { variante_sku_id: SKU_A, precio_anterior: 1000, precio_nuevo: 1250 }, // +25%
  ]);
  assert.equal(resultado.items[0].variacion_porcentual, 25);
  assert.equal(resultado.variacion_porcentual_maxima, 25);
  assert.equal(resultado.requiere_aprobacion, true);
});

test("calcularResultadoPreview: una baja de precio de la misma magnitud también dispara el umbral (Math.abs)", () => {
  const resultado = calcularResultadoPreview([
    { variante_sku_id: SKU_A, precio_anterior: 1000, precio_nuevo: 750 }, // -25%
  ]);
  assert.equal(resultado.items[0].variacion_porcentual, -25);
  assert.equal(resultado.variacion_porcentual_maxima, 25);
  assert.equal(resultado.requiere_aprobacion, true);
});

test("calcularResultadoPreview: la variación máxima del lote es el máximo por magnitud entre varios ítems, ítems sin precio previo no participan", () => {
  const resultado = calcularResultadoPreview([
    { variante_sku_id: SKU_A, precio_anterior: 1000, precio_nuevo: 1100 }, // +10%
    { variante_sku_id: SKU_B, precio_anterior: 2000, precio_nuevo: 2500 }, // +25% ← máximo
    { variante_sku_id: SKU_C, precio_anterior: null, precio_nuevo: 500 }, // excluido
  ]);
  assert.equal(resultado.variacion_porcentual_maxima, 25);
  assert.equal(resultado.requiere_aprobacion, true);
  assert.equal(resultado.items.find((i) => i.variante_sku_id === SKU_C)?.variacion_porcentual, null);
});

test("calcularResultadoPreview: todos los ítems sin precio previo (primera publicación) da variación 0, sin requerir aprobación", () => {
  const resultado = calcularResultadoPreview([
    { variante_sku_id: SKU_A, precio_anterior: null, precio_nuevo: 1000 },
    { variante_sku_id: SKU_B, precio_anterior: null, precio_nuevo: 2000 },
  ]);
  assert.equal(resultado.variacion_porcentual_maxima, 0);
  assert.equal(resultado.requiere_aprobacion, false);
});

// ──────────────────────────────────────────────────────────────────────────────
// derivarEstadoListaPrecioVersion
// ──────────────────────────────────────────────────────────────────────────────

const AHORA = new Date("2026-06-15T12:00:00.000Z");

test("derivarEstadoListaPrecioVersion: publicada=false siempre es PENDIENTE_APROBACION", () => {
  const estado = derivarEstadoListaPrecioVersion(
    { publicada: false, fecha_inicio_vigencia: new Date("2026-06-01T00:00:00.000Z") },
    false,
    AHORA,
  );
  assert.equal(estado, "PENDIENTE_APROBACION");
});

test("derivarEstadoListaPrecioVersion: publicada con fecha futura es FUTURA, aunque se marque como 'vigente'", () => {
  const estado = derivarEstadoListaPrecioVersion(
    { publicada: true, fecha_inicio_vigencia: new Date("2026-06-20T00:00:00.000Z") },
    true,
    AHORA,
  );
  assert.equal(estado, "FUTURA");
});

test("derivarEstadoListaPrecioVersion: publicada, fecha pasada, es la vigente resuelta → VIGENTE", () => {
  const estado = derivarEstadoListaPrecioVersion(
    { publicada: true, fecha_inicio_vigencia: new Date("2026-06-01T00:00:00.000Z") },
    true,
    AHORA,
  );
  assert.equal(estado, "VIGENTE");
});

test("derivarEstadoListaPrecioVersion: publicada, fecha pasada, pero NO es la vigente resuelta → HISTORICA", () => {
  const estado = derivarEstadoListaPrecioVersion(
    { publicada: true, fecha_inicio_vigencia: new Date("2026-05-01T00:00:00.000Z") },
    false,
    AHORA,
  );
  assert.equal(estado, "HISTORICA");
});

// ──────────────────────────────────────────────────────────────────────────
// Seguimiento post-A3 (2026-09-26): FUTURA se decide por día de negocio, no
// por instante — una fecha-solo de "mañana" (medianoche UTC) no debe dejar
// de ser FUTURA 3 h antes de la medianoche real de Argentina.
// ──────────────────────────────────────────────────────────────────────────

test("derivarEstadoListaPrecioVersion: una fecha-solo de MAÑANA sigue siendo FUTURA a las 22:00 hora Argentina de hoy", () => {
  const estado = derivarEstadoListaPrecioVersion(
    { publicada: true, fecha_inicio_vigencia: new Date("2026-09-27T00:00:00.000Z") }, // fecha-solo: "mañana"
    true,
    new Date("2026-09-27T01:00:00.000Z"), // 22:00 ART del día actual (26)
  );
  assert.equal(estado, "FUTURA");
});

test("derivarEstadoListaPrecioVersion: la misma versión deja de ser FUTURA justo a la medianoche real de Argentina", () => {
  const estado = derivarEstadoListaPrecioVersion(
    { publicada: true, fecha_inicio_vigencia: new Date("2026-09-27T00:00:00.000Z") },
    true,
    new Date("2026-09-27T03:00:00.000Z"), // 00:00 ART del día 27
  );
  assert.equal(estado, "VIGENTE");
});
