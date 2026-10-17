import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ObtenerStockPorVarianteParamsSchema } from "../../schemas/inventario.schema.ts";

/**
 * Mejora UX — stock disponible por depósito en alta de Presupuesto (HU-B3,
 * task_mejora_ux_stock_deposito_presupuesto.md).
 *
 * Tests source-regex sobre `stock.service.ts` y el Route Handler nuevo
 * (mismo patrón que `reserva.test.ts` / `presupuesto.service.test.ts` — el
 * service no puede importarse en Node por `import "server-only"`).
 */

const variante = "11111111-1111-4111-8111-111111111111";

const fuenteServicio = readFileSync(
  new URL("./stock.service.ts", import.meta.url),
  "utf8",
);
const sliceServicio = fuenteServicio.slice(
  fuenteServicio.indexOf("export async function obtenerStockPorVarianteYDepositos"),
  fuenteServicio.indexOf("export async function obtenerStockFisicoTotal"),
);

const fuenteRuta = readFileSync(
  new URL(
    "../../../app/api/inventario/variantes/[id]/stock-por-deposito/route.ts",
    import.meta.url,
  ),
  "utf8",
);

// ── Zod schema ───────────────────────────────────────────────────────────────

test("ObtenerStockPorVarianteParamsSchema acepta un UUID válido", () => {
  assert.equal(
    ObtenerStockPorVarianteParamsSchema.safeParse({ variante_sku_id: variante }).success,
    true,
  );
});

test("ObtenerStockPorVarianteParamsSchema rechaza un id que no es UUID", () => {
  assert.equal(
    ObtenerStockPorVarianteParamsSchema.safeParse({ variante_sku_id: "no-es-uuid" }).success,
    false,
  );
});

// ── obtenerStockPorVarianteYDepositos() ─────────────────────────────────────

test("valida que la variante exista y esté activa antes de consultar depósitos, con VARIANTE_NO_ENCONTRADA", () => {
  const idxVariante = sliceServicio.indexOf("prisma.varianteSKU.findFirst");
  const idxDepositos = sliceServicio.indexOf("prisma.deposito.findMany");
  assert.ok(idxVariante > -1 && idxDepositos > -1);
  assert.ok(idxVariante < idxDepositos);
  assert.match(sliceServicio, /throw new ServiceError\(\s*\n?\s*"VARIANTE_NO_ENCONTRADA"/);
});

test("parte del listado de depósitos activos, no de StockDeposito — ningún depósito activo queda afuera", () => {
  assert.match(sliceServicio, /prisma\.deposito\.findMany\(\{\s*\n\s*where: \{ is_active: true, deleted_at: null \}/);
  assert.match(sliceServicio, /cantidadPorDeposito\.get\(deposito\.id\) \?\? 0/);
  assert.match(sliceServicio, /depositos\.map\(\(deposito\) => \(\{/);
});

test("consulta StockDeposito con el mismo criterio de activo/no-borrado que obtenerStockDisponible(), sin acotar deposito_id", () => {
  assert.match(sliceServicio, /variante_sku_id: varianteSkuId,\s*\n\s*is_active: true,\s*\n\s*deleted_at: null,\s*\n\s*variante_sku: \{ is_active: true, deleted_at: null \},\s*\n\s*deposito: \{ is_active: true, deleted_at: null \},/);
  assert.doesNotMatch(sliceServicio, /deposito_id: depositoId/);
});

test("no abre $transaction ni emite eventos de dominio (función de solo lectura)", () => {
  assert.doesNotMatch(sliceServicio, /\$transaction/);
  assert.doesNotMatch(sliceServicio, /domainEventBus\.emit/);
});

// ── GET /api/inventario/variantes/[id]/stock-por-deposito ───────────────────

test("la ruta nueva delega en obtenerStockPorVarianteYDepositos() y valida con ObtenerStockPorVarianteParamsSchema", () => {
  assert.match(fuenteRuta, /ObtenerStockPorVarianteParamsSchema\.safeParse/);
  assert.match(fuenteRuta, /obtenerStockPorVarianteYDepositos\(parsed\.data\.variante_sku_id\)/);
});

test("la ruta nueva usa withAuth (no withPermission) — mismo criterio que depositos/[id]/productos", () => {
  assert.match(fuenteRuta, /export const GET = withAuth\(/);
  assert.doesNotMatch(fuenteRuta, /withPermission\(/);
});

test("la ruta nueva mapea VARIANTE_NO_ENCONTRADA a 404", () => {
  assert.match(
    fuenteRuta,
    /err\.code === "VARIANTE_NO_ENCONTRADA" \? 404 : 400/,
  );
});
