import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `comprobante-fiscal.service.ts` (mismo patrón que
 * `presupuesto.service.test.ts` / `pedido-venta.service.test.ts` — sin mock
 * de prisma, el archivo no puede importarse en Node por `import
 * "server-only"`). Cubren `obtenerComprobantePorId()` (HU-B7 §3, único
 * agregado de esta rama) — caso encontrado y caso no encontrado
 * (task_relos.md §6).
 */

const fuente = readFileSync(new URL("./comprobante-fiscal.service.ts", import.meta.url), "utf8");

const sliceObtener = fuente.slice(
  fuente.indexOf("export async function obtenerComprobantePorId"),
);

test("obtenerComprobantePorId busca por id con findUnique, nunca findFirst/findMany", () => {
  assert.match(sliceObtener, /prisma\.comprobanteFiscal\.findUnique\(\{\s*where:\s*\{\s*id\s*\}/);
  assert.doesNotMatch(sliceObtener, /findFirst|findMany/);
});

test("obtenerComprobantePorId — caso no encontrado: lanza ServiceError COMPROBANTE_NO_ENCONTRADO con el mensaje de spec §4", () => {
  assert.match(
    sliceObtener,
    /if \(!comprobante\) \{\s*throw new ServiceError\(\s*"COMPROBANTE_NO_ENCONTRADO",\s*"No se encontró el comprobante solicitado",?\s*\);\s*\}/,
  );
});

test("obtenerComprobantePorId — caso encontrado: devuelve el shape exacto de spec §4 (comprobante_id/pedido_venta_id/tipo_comprobante/cae_simulado/qr_data_url/es_simulado/monto_total)", () => {
  for (const campo of [
    "comprobante_id: comprobante.id",
    "pedido_venta_id: comprobante.pedido_venta_id",
    "tipo_comprobante: comprobante.tipo_comprobante",
    "cae_simulado: comprobante.cae_simulado",
    "qr_data_url: comprobante.qr_data_url",
    "es_simulado: comprobante.es_simulado",
    "monto_total: comprobante.monto_total.toNumber()",
  ]) {
    assert.ok(sliceObtener.includes(campo), `falta el campo "${campo}" en el shape de retorno`);
  }
});

test("obtenerComprobantePorId no muta ni recalcula nada — sin lógica de negocio más allá de la búsqueda (spec §3.4, comprobante inmutable)", () => {
  assert.doesNotMatch(sliceObtener, /\.(update|delete|create)\(/);
});
