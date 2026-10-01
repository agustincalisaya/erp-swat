/**
 * HU-E1 — Nivel 1 (unit, sin DB): reglas puras de comprabilidad, fusión y
 * token del carrito, más asserts de código fuente (molde de roles-hu-e10.test.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { evaluarComprabilidad, type SnapshotComprabilidad } from "./comprabilidad.ts";
import { planificarFusion } from "./carrito.reglas.ts";
import { derivarEstadoVisiblePedidoWeb } from "./pedido-web.reglas.ts";

process.env.CARRITO_COOKIE_SECRET = "a".repeat(64);
const { generarTokenCarrito, leerCookieCarrito, serializarCookieCarrito } = await import("./carrito-token.ts");

// ── Comprabilidad (D6) ────────────────────────────────────────────────────────

const ok = { is_active: true, deleted_at: null };
const base: SnapshotComprabilidad = {
  variante: ok,
  producto: ok,
  contenido: { ...ok, visibilidad_web: true, descripcion: "Camisa", fotos_activas: 1 },
  precio_venta: 21100,
};

test("comprabilidad: un artículo completo es comprable", () => {
  assert.deepEqual(evaluarComprabilidad(base), { comprable: true });
});

test("comprabilidad: los 5 motivos de 'desactivado' (D6)", () => {
  const baja = { is_active: false, deleted_at: new Date() };
  const casos: [SnapshotComprabilidad, string][] = [
    [{ ...base, variante: baja }, "SKU_INACTIVO"],
    [{ ...base, variante: { is_active: true, deleted_at: new Date() } }, "SKU_INACTIVO"],
    [{ ...base, producto: baja }, "PRODUCTO_INACTIVO"],
    [{ ...base, contenido: null }, "NO_VISIBLE_WEB"],
    [{ ...base, contenido: { ...base.contenido!, visibilidad_web: false } }, "NO_VISIBLE_WEB"],
    [{ ...base, contenido: { ...base.contenido!, ...baja } }, "NO_VISIBLE_WEB"],
    [{ ...base, contenido: { ...base.contenido!, fotos_activas: 0 } }, "NO_PUBLICABLE"],
    [{ ...base, contenido: { ...base.contenido!, descripcion: "  " } }, "NO_PUBLICABLE"],
    [{ ...base, precio_venta: null }, "SIN_PRECIO_VIGENTE"],
  ];
  for (const [snapshot, motivo] of casos) {
    assert.deepEqual(evaluarComprabilidad(snapshot), { comprable: false, motivo });
  }
});

test("comprabilidad: con varios motivos se informa el primero en orden fijo", () => {
  const resultado = evaluarComprabilidad({
    ...base,
    variante: { is_active: false, deleted_at: null },
    precio_venta: null,
  });
  assert.deepEqual(resultado, { comprable: false, motivo: "SKU_INACTIVO" });
});

// ── Fusión de carritos (CA7) ──────────────────────────────────────────────────

test("fusión: suma repetidos, reactiva quitados, crea nuevos e ignora inactivos del visitante", () => {
  const acciones = planificarFusion(
    [
      { id: "o1", variante_sku_id: "A", cantidad: 2, is_active: true },
      { id: "o2", variante_sku_id: "B", cantidad: 1, is_active: true },
      { id: "o3", variante_sku_id: "C", cantidad: 3, is_active: true },
      { id: "o4", variante_sku_id: "D", cantidad: 9, is_active: false },
    ],
    [
      { id: "d1", variante_sku_id: "A", cantidad: 1, is_active: true },
      { id: "d2", variante_sku_id: "B", cantidad: 5, is_active: false },
    ],
  );
  assert.deepEqual(acciones, [
    { tipo: "SUMAR", item_destino_id: "d1", nueva_cantidad: 3, item_origen_id: "o1" },
    { tipo: "REACTIVAR", item_destino_id: "d2", nueva_cantidad: 1, item_origen_id: "o2" },
    { tipo: "CREAR", variante_sku_id: "C", cantidad: 3, item_origen_id: "o3" },
  ]);
});

test("fusión: carrito de visitante vacío no genera acciones; destino vacío crea todo", () => {
  assert.deepEqual(planificarFusion([], [{ id: "d1", variante_sku_id: "A", cantidad: 1, is_active: true }]), []);
  assert.equal(planificarFusion([{ id: "o1", variante_sku_id: "A", cantidad: 1, is_active: true }], [])[0].tipo, "CREAR");
});

// ── Estado visible del pedido web (coordinación con HU-E7) ─────────────────────

test("pedido web: 'Reserva vencida' se deriva de ttl_expiracion (incluido el instante exacto), sin estado persistido", () => {
  const ahora = new Date("2026-10-01T15:00:00.000Z");
  assert.equal(derivarEstadoVisiblePedidoWeb(new Date("2026-10-01T15:00:01.000Z"), ahora), "PAGO_PENDIENTE");
  assert.equal(derivarEstadoVisiblePedidoWeb(new Date("2026-10-01T15:00:00.000Z"), ahora), "RESERVA_VENCIDA");
  assert.equal(derivarEstadoVisiblePedidoWeb(new Date("2026-10-01T14:00:00.000Z"), ahora), "RESERVA_VENCIDA");
});

// ── Token del carrito ─────────────────────────────────────────────────────────

test("token de carrito: ida y vuelta, y rechazo de firmas alteradas o formatos inválidos", () => {
  const token = generarTokenCarrito();
  assert.match(token, /^[0-9a-f]{48}$/);
  const cookie = serializarCookieCarrito(token);
  assert.equal(leerCookieCarrito(cookie), token);
  assert.equal(leerCookieCarrito(`${token}.firma-falsa`), null);
  assert.equal(leerCookieCarrito(`${generarTokenCarrito()}.${cookie.split(".")[1]}`), null);
  assert.equal(leerCookieCarrito(token), null);
  assert.equal(leerCookieCarrito(undefined), null);
});

// ── Código fuente (reglas transversales) ──────────────────────────────────────

const raiz = new URL("../../../../", import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, raiz), "utf8");
function archivos(dir: string): string[] {
  const absoluto = new URL(dir, raiz);
  return readdirSync(absoluto).flatMap((nombre) => {
    const relativo = join(dir, nombre).replaceAll("\\", "/");
    return statSync(new URL(relativo, raiz)).isDirectory() ? archivos(`${relativo}/`) : [relativo];
  });
}
const fuentesE1 = [
  // Excluye los tests y su soporte (*.test.ts, *.test-fixtures.ts): los fixtures crean stock a propósito.
  ...archivos("src/lib/services/ecommerce/").filter((f) => !/\.test[.-]/.test(f)),
  ...archivos("src/app/api/tienda/"),
  ...archivos("src/app/(tienda)/"),
];

test("Regla N.° 1: ningún archivo de E1 hace delete/deleteMany físico", () => {
  for (const archivo of fuentesE1) {
    // Llamadas de Prisma (`prisma.x.delete(` / `tx.x.deleteMany(`); `response.cookies.delete` no es la base.
    assert.doesNotMatch(leer(archivo), /(prisma|tx|db)\.\w+\.(delete|deleteMany)\(/, archivo);
  }
});

test("la tienda no usa el RBAC interno: ningún withPermission bajo app/api/tienda ni app/(tienda)", () => {
  for (const archivo of fuentesE1.filter((f) => f.startsWith("src/app/"))) {
    assert.doesNotMatch(leer(archivo), /import[^;]*(withPermission|withAuth|getServerSession)|(withPermission|withAuth)\(/, archivo);
  }
  assert.match(leer("src/app/api/tienda/checkout/route.ts"), /export const POST = withSesionClienteWeb\(/);
});

test("Módulo E no duplica Módulo A/B: no toca stock, reservas ni PedidoVenta directo", () => {
  for (const archivo of fuentesE1) {
    const fuente = leer(archivo);
    assert.doesNotMatch(fuente, /stockDeposito\.(update|updateMany|upsert|create)/, archivo);
    assert.doesNotMatch(fuente, /reserva\.(create|update|updateMany)/, archivo);
    assert.doesNotMatch(fuente, /pedidoVenta\.create|listaPrecioVentaItem\./, archivo);
  }
  const checkout = leer("src/lib/services/ecommerce/checkout.service.ts");
  assert.match(checkout, /crearReservaTx\(/);
  assert.match(checkout, /liberarReservasVencidasTx\(/);
  assert.match(checkout, /crearPedidoVentaReservadoTx\(/);
  assert.match(checkout, /origen_reserva: "CHECKOUT_WEB"/);
});

test("checkout: la conversión del carrito es la primera sentencia de la transacción y libera vencidas antes de reservar (D10/D4.2)", () => {
  const checkout = leer("src/lib/services/ecommerce/checkout.service.ts");
  const cuerpo = checkout.slice(checkout.indexOf("return prisma.$transaction("));
  const conversion = cuerpo.indexOf("tx.carritoWeb.updateMany");
  const liberacion = cuerpo.indexOf("liberarReservasVencidasTx(");
  const reserva = cuerpo.indexOf("crearReservaTx(");
  const pedido = cuerpo.indexOf("crearPedidoVentaReservadoTx(");
  assert.ok(conversion > -1 && conversion < liberacion && liberacion < reserva && reserva < pedido);
  assert.match(cuerpo, /deletion_reason: MOTIVO_CARRITO_CONVERTIDO/);
  assert.match(checkout, /MOTIVO_CARRITO_CONVERTIDO = "convertido en pedido"/);
  assert.match(checkout, /estado_ecommerce: "PAGO_PENDIENTE"/);
});
