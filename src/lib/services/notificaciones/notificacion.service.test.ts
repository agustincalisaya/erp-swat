import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Tests source-regex de HU-F3 (task §7 Nivel 1) — mismo patrón que
 * `plantilla-notificacion.service.test.ts`: servicio, rutas y listener usan
 * `server-only`/alias `@/`, así que se verifican sobre el fuente. El
 * comportamiento real se verifica en `notificacion.http.integration.test.ts`.
 */

/** Sin comentarios: los docstrings mencionan `await`/`prisma.notificacion.create()` en prosa. */
const sinComentarios = (fuente: string) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const leer = (ruta: string) => sinComentarios(readFileSync(new URL(ruta, import.meta.url), "utf8"));

const SERVICIO = leer("./notificacion.service.ts");
const LISTENER = leer("../../events/listeners/notificacion.listener.ts");
const ACTIONS = leer("../../../app/(dashboard)/notificaciones/actions.ts");
const RUTAS = {
  bandeja: leer("../../../app/api/notificaciones/route.ts"),
  leer: leer("../../../app/api/notificaciones/[id]/leer/route.ts"),
  todas: leer("../../../app/api/notificaciones/marcar-todas-leidas/route.ts"),
  archivar: leer("../../../app/api/notificaciones/[id]/archivar/route.ts"),
};

const SRC = fileURLToPath(new URL("../../../", import.meta.url));

function fuentesDe(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(dir, f));
}

test("rutas: wrappers finos — sin prisma, con withAuth, delegan en el servicio", () => {
  for (const [nombre, fuente] of Object.entries(RUTAS)) {
    assert.doesNotMatch(fuente, /from "@\/lib\/db\/prisma"|prisma\./, `${nombre} usa prisma`);
    assert.match(fuente, /withAuth\(/, `${nombre} sin withAuth`);
    assert.match(fuente, /notificacion\.service"/, `${nombre} no delega en el servicio`);
  }
});

test("rutas y actions: el destinatario sale de la sesión, nunca de query/body", () => {
  for (const [nombre, fuente] of Object.entries({ ...RUTAS, actions: ACTIONS })) {
    assert.doesNotMatch(fuente, /searchParams\.get\(\s*["'](usuario_id|cuenta_cliente_web_id)/, nombre);
    assert.doesNotMatch(fuente, /req\.json\(/, `${nombre} lee body`);
    assert.doesNotMatch(fuente, /usuario_id:\s*(?!session\.userId)[\w.]+/, `${nombre} arma el destinatario sin la sesión`);
  }
});

test("rutas: ajena o inexistente → 404 NOTIFICACION_NO_ENCONTRADA", () => {
  for (const fuente of [RUTAS.leer, RUTAS.archivar]) {
    assert.match(fuente, /NOTIFICACION_NO_ENCONTRADA"\)\s*\{[\s\S]*?status:\s*404/);
  }
});

test("servicio: sin DELETE físico", () => {
  assert.doesNotMatch(SERVICIO, /\.delete(Many)?\s*\(/);
  for (const fuente of Object.values(RUTAS)) assert.doesNotMatch(fuente, /export const DELETE/);
});

test("servicio: archivar = baja lógica con is_active/deleted_at/deleted_by", () => {
  const archivar = SERVICIO.slice(SERVICIO.indexOf("export async function archivarNotificacion"));
  assert.match(archivar, /is_active:\s*false,\s*deleted_at:\s*new Date\(\),\s*deleted_by:/);
  assert.doesNotMatch(archivar, /deletion_reason/);
});

test("servicio: toda consulta de bandeja filtra por el destinatario", () => {
  for (const nombre of ["listarNotificaciones", "marcarNotificacionLeida", "marcarTodasLeidas", "archivarNotificacion"]) {
    const inicio = SERVICIO.indexOf(`export async function ${nombre}`);
    const cuerpo = SERVICIO.slice(inicio, SERVICIO.indexOf("\n}\n", inicio));
    assert.match(cuerpo, /filtroDestinatario\(destinatario\)/, nombre);
  }
});

test("servicio: orden CRITICA primero (enum por declaración) y luego más recientes", () => {
  assert.match(SERVICIO, /orderBy:\s*\[\{\s*prioridad:\s*"asc"\s*\},\s*\{\s*created_at:\s*"desc"\s*\}\]/);
});

test("servicio: no emite eventos de auditoría (spec F §4)", () => {
  assert.doesNotMatch(SERVICIO, /domainEventBus|registrarAuditLog/);
});

test("listener: sin await hacia el emisor y con captura de errores síncronos y asíncronos", () => {
  assert.doesNotMatch(LISTENER, /\bawait\b/);
  assert.match(LISTENER, /void generarNotificaciones\(/);
  assert.match(LISTENER, /\.catch\(/);
  assert.match(LISTENER, /try\s*\{[\s\S]*s\.armar\(payload\)[\s\S]*\}\s*catch/);
});

test("listener: suscripciones activas sin eventos duplicados", () => {
  const eventos = [...LISTENER.matchAll(/evento:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(eventos, [
    "ecommerce:carrito_articulo_no_disponible",
    "ecommerce:pedido_admitido_cola",
    "ecommerce:pedido_cancelado",
    "ecommerce:pedido_pago_confirmado",
    "ecommerce:pedido_vencido_sin_retiro",
    "ecommerce:plazo_retiro_por_vencer",
    "stock:umbral_critico_alcanzado",
    "usuario:suspendido_automaticamente",
  ]);
  assert.equal(new Set(eventos).size, eventos.length);
});

test("listener (Punto abierto 5): clave_origen por ocurrencia", () => {
  assert.match(LISTENER, /clave_origen:\s*`\$\{p\.movimiento_id_origen\}:\$\{p\.stock_deposito_id\}`/);
  assert.match(LISTENER, /clave_origen:\s*`\$\{p\.usuario_id\}:\$\{bloqueadoHasta\}`/);
});

test("listener (Punto abierto 9): Rol.nombre se usa solo para routing de destinatarios", () => {
  assert.match(LISTENER, /roles:\s*\["ENCARGADO_DEPOSITO"\]/);
  assert.match(LISTENER, /usuario_ids:\s*\[p\.usuario_id\],\s*roles:\s*\["ADMINISTRADOR"\]/);
  assert.match(
    LISTENER,
    /evento:\s*"ecommerce:pedido_admitido_cola"[\s\S]*?clave_origen:\s*p\.evento_id[\s\S]*?destinatarios:\s*\{\s*roles:\s*\["OPERADOR_PICK_PACK"\]\s*\}/,
  );
  const inicioPago = LISTENER.indexOf('evento: "ecommerce:pedido_pago_confirmado"');
  const inicioAdmision = LISTENER.indexOf('evento: "ecommerce:pedido_admitido_cola"');
  assert.ok(inicioPago !== -1 && inicioAdmision > inicioPago);
  assert.doesNotMatch(LISTENER.slice(inicioPago, inicioAdmision), /OPERADOR_PICK_PACK/);
});

test("ninguna escritura de Notificacion fuera de notificacion.service.ts", () => {
  const permitido = path.join(SRC, "lib", "services", "notificaciones", "notificacion.service.ts");
  const infractores = fuentesDe(SRC).filter(
    (archivo) =>
      archivo !== permitido &&
      /\.notificacion\.(create|createMany|upsert)\s*\(/.test(sinComentarios(readFileSync(archivo, "utf8"))),
  );
  assert.deepEqual(infractores, []);
});
