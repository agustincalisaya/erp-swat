import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * HU-F1 (R3) — contratos del service de gestión del Conector.
 *
 * Mismo patrón que `proveedor.service.test.ts` / `aes.test.ts`: el runner
 * unitario no puede importar el service (`server-only` + alias `@/`), así que
 * los contratos se verifican source-regex sobre la fuente. Verifica cifrado
 * antes de persistir, enmascarado, unicidad, puerta de PRODUCCION, baja lógica
 * (sin `delete()`), bitácora paginada y ausencia de `fetch`/SDK.
 */

const fuente = readFileSync(new URL("./conector-pago.service.ts", import.meta.url), "utf8");

// ──────────────────────────────────────────────────────────────────────────────
// Constante de permiso (spec R4)
// ──────────────────────────────────────────────────────────────────────────────

test("exporta PERMISO_ADMINISTRAR_CONECTOR = integraciones:administrar_conector", () => {
  assert.match(
    fuente,
    /export const PERMISO_ADMINISTRAR_CONECTOR = "integraciones:administrar_conector"/,
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// R3.1 — Alta: cifrado AES-256 ANTES de create + unicidad + enmascarado
// ──────────────────────────────────────────────────────────────────────────────

test("crearConector cifra los 3 campos sensibles antes de llamar a Prisma", () => {
  const cuerpo = fuente.slice(
    fuente.indexOf("export async function crearConector"),
    fuente.indexOf("export async function ejecutarHealthCheck"),
  );
  const idxAccess = cuerpo.indexOf("encrypt(input.access_token)");
  const idxPublic = cuerpo.indexOf("encrypt(input.public_key)");
  const idxWebhook = cuerpo.indexOf("encrypt(input.webhook_secret)");
  const idxCreate = cuerpo.indexOf(".create(");
  assert.ok(idxAccess > 0 && idxPublic > 0 && idxWebhook > 0, "debe cifrar las 3 credenciales");
  assert.ok(idxCreate > idxAccess && idxCreate > idxPublic && idxCreate > idxWebhook, "encrypt ANTES de create");
  assert.match(cuerpo, /access_token_cifrado: accessToken\.ciphertext/);
  assert.match(cuerpo, /public_key_cifrada: publicKey\.ciphertext/);
  assert.match(cuerpo, /webhook_secret_cifrado: webhookSecret\.ciphertext/);
});

test("crearConector nace INACTIVO y valida unicidad ACTIVO por entorno dentro de la transacción", () => {
  const cuerpo = fuente.slice(
    fuente.indexOf("export async function crearConector"),
    fuente.indexOf("export async function ejecutarHealthCheck"),
  );
  assert.match(cuerpo, /prisma\.\$transaction\(/);
  assert.match(cuerpo, /entorno: input\.entorno, estado: "ACTIVO", is_active: true, deleted_at: null/);
  assert.match(cuerpo, /estado: "INACTIVO"/);
  assert.match(cuerpo, /throw new ServiceError\(\s*"CONECTOR_ACTIVO_EXISTENTE"/);
});

test("enmascararCredencial conserva prefijo y últimos 4 y nunca devuelve el valor completo", () => {
  const cuerpo = fuente.slice(fuente.indexOf("export function enmascararCredencial"));
  assert.match(cuerpo, /indexOf\("-"\)/);
  assert.match(cuerpo, /••••••••/);
  assert.match(cuerpo, /slice\(-4\)/);
});

test("el DTO devuelto por el alta es enmascarado (nunca plaintext)", () => {
  assert.match(fuente, /access_token_enmascarado: enmascararCredencial\(c\.access_token\)/);
  assert.match(fuente, /public_key_enmascarada: enmascararCredencial\(c\.public_key\)/);
  assert.match(fuente, /webhook_secret_enmascarado: enmascararCredencial\(c\.webhook_secret\)/);
});

// ──────────────────────────────────────────────────────────────────────────────
// R3.2 — Health-check por el Adapter (sin fetch), puerta PRODUCCION
// ──────────────────────────────────────────────────────────────────────────────

test("el health-check pasa por el Adapter y el service NO hace fetch ni importa el SDK", () => {
  assert.match(fuente, /import \{ healthCheck \} from "@\/lib\/integraciones\/mercadopago\/adapter"/);
  assert.doesNotMatch(fuente, /\bfetch\(/);
  assert.doesNotMatch(fuente, /from "mercadopago"/);
  assert.doesNotMatch(fuente, /api\.mercadopago\.com/);
});

test("health-check: fallo mantiene estado y responde HEALTH_CHECK_FALLIDO (422)", () => {
  assert.match(fuente, /if \(!ok\)/);
  assert.match(fuente, /throw new ServiceError\("HEALTH_CHECK_FALLIDO"/);
});

test("PRODUCCION no se activa con un solo health-check: HEALTH_CHECK_REQUERIDO (422)", () => {
  const cuerpo = fuente.slice(fuente.indexOf("export async function ejecutarHealthCheck"));
  assert.match(cuerpo, /conector\.entorno === "PRODUCCION" && conector\.ultimo_health_check_exitoso_at === null/);
  assert.match(cuerpo, /throw new ServiceError\(\s*"HEALTH_CHECK_REQUERIDO"/);
  // El primer éxito persiste el timestamp sin activar.
  const idxRequerido = cuerpo.indexOf('"HEALTH_CHECK_REQUERIDO"');
  const idxPrimerUpdate = cuerpo.indexOf("data: { ultimo_health_check_exitoso_at: ahora }");
  assert.ok(idxPrimerUpdate > 0 && idxPrimerUpdate < idxRequerido, "persiste timestamp antes de exigir el segundo check");
  // El camino de activación setea estado ACTIVO + timestamp.
  assert.match(cuerpo, /data: \{ estado: "ACTIVO", ultimo_health_check_exitoso_at: ahora \}/);
});

// ──────────────────────────────────────────────────────────────────────────────
// R3.3 — Bitácora paginada
// ──────────────────────────────────────────────────────────────────────────────

test("listarBitacora pagina por created_at desc con shape items + paginacion", () => {
  const cuerpo = fuente.slice(
    fuente.indexOf("export async function listarBitacora"),
    fuente.indexOf("export async function listarConectores"),
  );
  assert.match(cuerpo, /orderBy: \{ created_at: "desc" \}/);
  assert.match(cuerpo, /skip: \(page - 1\) \* page_size/);
  assert.match(cuerpo, /take: page_size/);
  assert.match(cuerpo, /paginacion: \{/);
  assert.match(cuerpo, /pagina_actual: page/);
  assert.match(cuerpo, /total_paginas: Math\.ceil\(total \/ page_size\)/);
  assert.match(cuerpo, /por_pagina: page_size/);
  // Sin datos sensibles: solo operación, resultado y fecha.
  assert.doesNotMatch(cuerpo, /access_token|public_key|webhook_secret/);
});

// ──────────────────────────────────────────────────────────────────────────────
// R4.6 — Listado enmascarado (Server Component)
// ──────────────────────────────────────────────────────────────────────────────

test("listarConectores descifra y enmascara, sin exponer plaintext", () => {
  const cuerpo = fuente.slice(fuente.indexOf("export async function listarConectores"));
  assert.match(cuerpo, /decrypt\(\{ ciphertext: f\.access_token_cifrado/);
  assert.match(cuerpo, /aEnmascarado\(/);
});

// ──────────────────────────────────────────────────────────────────────────────
// R3.4 — Baja lógica (sin delete)
// ──────────────────────────────────────────────────────────────────────────────

test("darDeBajaConector setea los 4 campos de soft delete + estado INACTIVO", () => {
  const cuerpo = fuente.slice(fuente.indexOf("export async function darDeBajaConector"));
  assert.match(cuerpo, /is_active: false/);
  assert.match(cuerpo, /deleted_at: ahora/);
  assert.match(cuerpo, /deleted_by: usuarioId/);
  assert.match(cuerpo, /deletion_reason: deletionReason/);
  assert.match(cuerpo, /estado: "INACTIVO"/);
});

test("el service nunca borra filas (prohibido prisma.*.delete()) ni loguea credenciales", () => {
  // Se ignoran los comentarios: el docstring menciona `prisma.*.delete()` como prohibición.
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /\.delete\(/);
  assert.doesNotMatch(codigo, /deleteMany\(/);
  assert.doesNotMatch(codigo, /console\./);
});
