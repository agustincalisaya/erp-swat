import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `lista-precio-venta.service.ts` (HU-B9, task §7
 * Nivel 1) — mismo patrón que `cuenta-corriente.service.test.ts`: el servicio
 * usa `import "server-only"`. El comportamiento real se verifica contra una
 * base descartable en `lista-precio-venta.http.integration.test.ts`.
 */

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const fuente = leer("./lista-precio-venta.service.ts");

function funcion(nombre: string): string {
  const inicio = fuente.indexOf(`export async function ${nombre}`);
  assert.ok(inicio > -1, `no se encontró ${nombre}`);
  const fin = fuente.indexOf("\n// ──", inicio + 10);
  return fuente.slice(inicio, fin === -1 ? undefined : fin);
}

const RUTAS = {
  versiones: "../../../app/api/ventas/lista-precios/versiones/route.ts",
  vigente: "../../../app/api/ventas/lista-precios/vigente/route.ts",
  sugerencia: "../../../app/api/ventas/lista-precios/sugerencia/[variante_sku_id]/route.ts",
};
const ACTIONS = "../../../app/(dashboard)/ventas/lista-precios/actions.ts";

const publicar = funcion("publicarVersionListaPrecioVenta");
const sugerencia = funcion("obtenerSugerenciaPrecio");

// ── Permisos y wrappers finos ───────────────────────────────────────────────

test("el permiso exportado coincide con el código sembrado en el seed", () => {
  assert.match(fuente, /PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS = "ventas:gestionar_lista_precios"/);
  assert.match(leer("../../../../prisma/seed.ts"), /"ventas:gestionar_lista_precios"/);
});

test("las 3 rutas quedan gateadas por UN único withPermission(ventas:gestionar_lista_precios)", () => {
  const metodos = { versiones: "POST", vigente: "GET", sugerencia: "GET" } as const;
  for (const [clave, ruta] of Object.entries(RUTAS)) {
    const codigo = leer(ruta);
    const metodo = metodos[clave as keyof typeof metodos];
    assert.match(
      codigo,
      new RegExp(`export const ${metodo} = withPermission\\(\\s*\\n\\s*PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS`),
      ruta,
    );
    assert.equal((codigo.match(/withPermission\(\s*\n/g) ?? []).length, 1, ruta);
  }
});

test("rutas y actions no acceden a prisma ni abren transacciones (sin lógica de negocio)", () => {
  for (const archivo of [...Object.values(RUTAS), ACTIONS]) {
    const codigo = leer(archivo);
    assert.doesNotMatch(codigo, /@\/lib\/db\/prisma/, archivo);
    assert.doesNotMatch(codigo, /\$transaction/, archivo);
  }
});

test("las Server Actions usan el sufijo Action y validan el permiso granular", () => {
  const codigo = leer(ACTIONS);
  assert.match(codigo, /^"use server";/);
  assert.match(codigo, /export async function publicarVersionListaPrecioVentaAction\(/);
  assert.match(codigo, /export async function obtenerSugerenciaPrecioAction\(/);
  assert.match(codigo, /usuarioTienePermiso\(session\.userId, PERMISO_VENTAS_GESTIONAR_LISTA_PRECIOS\)/);
});

test("el 422 de bajo costo propaga error.details en el POST (PROPUESTA aprobada)", () => {
  assert.match(leer(RUTAS.versiones), /details: err\.details/);
  assert.match(publicar, /\{ variante_sku_id: item\.variante_sku_id \}/);
});

// ── Inmutabilidad y Regla N.° 1 ─────────────────────────────────────────────

test("sin delete/deleteMany ni update sobre versiones o ítems (inmutabilidad)", () => {
  assert.doesNotMatch(fuente, /\.delete(Many)?\(/);
  assert.doesNotMatch(fuente, /listaPrecioVentaVersion\.update/);
  assert.doesNotMatch(fuente, /listaPrecioVentaItem\.update/);
});

// ── Publicación ─────────────────────────────────────────────────────────────

test("publicar: duplicados se rechazan ANTES de abrir la transacción", () => {
  const idxDup = publicar.indexOf('"ITEM_DUPLICADO_EN_VERSION"');
  const idxTx = publicar.indexOf("prisma.$transaction");
  assert.ok(idxDup > -1 && idxTx > idxDup);
});

test("publicar: orden lista única → variantes → bajo costo → escrituras, todo dentro de la $transaction", () => {
  const idxTx = publicar.indexOf("prisma.$transaction");
  const idxLista = publicar.indexOf('"LISTA_PRECIO_VENTA_NO_CONFIGURADA"');
  const idxVariante = publicar.indexOf('"VARIANTE_NO_ENCONTRADA"');
  const idxMotivo = publicar.indexOf('"MOTIVO_BAJO_COSTO_REQUERIDO"');
  const idxVersion = publicar.indexOf("tx.listaPrecioVentaVersion.create");
  const idxItems = publicar.indexOf("tx.listaPrecioVentaItem.createMany");
  assert.ok(idxTx > -1);
  assert.ok(idxLista > idxTx && idxVariante > idxLista && idxMotivo > idxVariante);
  assert.ok(idxVersion > idxMotivo && idxItems > idxVersion);
  assert.match(publicar, /listas\.length !== 1/);
});

test("publicar: costo vía obtenerCostoReposicionVigente (server-side, nunca del cliente)", () => {
  assert.match(publicar, /obtenerCostoReposicionVigente\(id\)/);
  assert.match(publicar, /costo_reposicion_referencia: costo/);
});

test("publicar: emite precio_venta:version_publicada DESPUÉS de la $transaction con el payload literal del spec", () => {
  const idxTx = publicar.indexOf("await prisma.$transaction");
  const idxEmit = publicar.indexOf('domainEventBus.emit("precio_venta:version_publicada"');
  assert.ok(idxTx > -1 && idxEmit > idxTx);
  const bloque = publicar.slice(idxEmit);
  for (const campo of ["version_id", "lista_id", "publicado_por_id", "vigente_desde", "items_publicados", "items_bajo_costo"]) {
    assert.match(bloque, new RegExp(`${campo}:`), `falta ${campo}`);
  }
  assert.equal((fuente.match(/domainEventBus\.emit\(/g) ?? []).length, 1);
});

// ── Sugerencia ──────────────────────────────────────────────────────────────

test("sugerencia: margen vía obtenerConfiguracion(clave) y costo vía HU-H8; sin literal 0.35 en el servicio", () => {
  assert.match(sugerencia, /obtenerConfiguracion\("VENTAS_MARGEN_SUGERIDO_PRECIO_VENTA"\)/);
  assert.match(sugerencia, /obtenerCostoReposicionVigente\(variante_sku_id\)/);
  assert.doesNotMatch(fuente, /0\.35/);
  assert.doesNotMatch(fuente, /fetch\(/);
});

// ── Resolver ────────────────────────────────────────────────────────────────

test("resolver: filtra vigente_desde lte, is_active en ítem/versión/lista y ordena desc con desempate created_at", () => {
  assert.match(fuente, /vigente_desde: \{ lte: ahora \}/);
  assert.equal((fuente.match(/is_active: true/g) ?? []).length >= 3, true);
  assert.match(fuente, /orderBy: \[\{ version: \{ vigente_desde: "desc" \} \}, \{ version: \{ created_at: "desc" \} \}\]/);
});

test("resolver singular: firma de spec + segundo parámetro opcional { prisma } (PROPUESTA aprobada)", () => {
  assert.match(
    fuente,
    /export async function resolverPrecioVentaVigente\(\s*\n\s*variante_sku_id: string,\s*\n\s*opciones\?: \{ prisma\?: Prisma\.TransactionClient \},/,
  );
  // La versión por lote (HU-E1) conserva su firma exacta.
  assert.match(
    fuente,
    /export async function resolverPreciosVentaVigentes\(\s*\n\s*variante_sku_ids: readonly string\[\],\s*\n\s*ahora: Date = new Date\(\),\s*\n\s*\)/,
  );
});

// ── Evento y listener ───────────────────────────────────────────────────────

test("el evento está tipado y el listener lo registra con la accion aprobada", () => {
  assert.match(leer("../../events/event-types.ts"), /"precio_venta:version_publicada": PrecioVentaVersionPublicadaPayload/);
  const listener = leer("../../events/listeners/audit-log.listener.ts");
  const idx = listener.indexOf('domainEventBus.on("precio_venta:version_publicada"');
  assert.ok(idx > -1);
  const bloque = listener.slice(idx, idx + 600);
  assert.match(bloque, /usuario_id: payload\.publicado_por_id/);
  assert.match(bloque, /accion: "PUBLICAR_VERSION_LISTA_PRECIO_VENTA"/);
  assert.match(bloque, /tabla_afectada: "versiones_lista_precio_venta"/);
  assert.match(bloque, /registro_id: payload\.version_id/);
  assert.match(bloque, /valor_anterior: null/);
});

test("el servicio nunca escribe AuditLog directo", () => {
  assert.doesNotMatch(fuente, /registrarAuditLog/);
  assert.doesNotMatch(fuente, /auditLog\./);
});
