import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * HU-F1 (R1) — contrato del reembolso y del health-check del Adapter.
 *
 * Mismo patrón que `aes.test.ts` / `proveedor.service.test.ts`: el runner
 * unitario (`node --experimental-strip-types`, sin `--conditions=react-server`
 * ni el resolver de `@/`) no puede importar `adapter.ts`/`conector.ts`
 * (`server-only` + alias `@/`), así que los contratos se verifican
 * source-regex sobre la fuente. `tipos.ts` sí es importable (sin
 * `server-only` ni alias).
 */

const adapter = readFileSync(new URL("./adapter.ts", import.meta.url), "utf8");
const conector = readFileSync(new URL("./conector.ts", import.meta.url), "utf8");
const tipos = readFileSync(new URL("./tipos.ts", import.meta.url), "utf8");

// ──────────────────────────────────────────────────────────────────────────────
// tipos.ts (R1.1) — tipo del reembolso, sin datos de tarjeta
// ──────────────────────────────────────────────────────────────────────────────

test("tipos.ts define ReembolsoSolicitado con refund_id/payment_id/monto/estado", () => {
  assert.match(tipos, /export interface ReembolsoSolicitado\s*\{/);
  assert.match(tipos, /refund_id: string/);
  assert.match(tipos, /payment_id: string/);
  assert.match(tipos, /monto: number/);
  assert.match(tipos, /estado: EstadoReembolsoDominio/);
});

test("tipos.ts define EstadoReembolsoDominio (APROBADO|RECHAZADO|PENDIENTE)", () => {
  assert.match(
    tipos,
    /export type EstadoReembolsoDominio = "APROBADO" \| "RECHAZADO" \| "PENDIENTE"/,
  );
});

test("ningún tipo/adaptador expone datos de tarjeta (CA1/R1.5)", () => {
  for (const fuente of [tipos, adapter]) {
    assert.doesNotMatch(fuente, /\bcard_number\b|\bcvv\b|\bsecurity_code\b|numero_tarjeta/i);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// conector.ts (R1.2) — OperacionConector + resolución por id
// ──────────────────────────────────────────────────────────────────────────────

test("OperacionConector incluye SOLICITAR_REEMBOLSO y HEALTH_CHECK (CA12)", () => {
  assert.match(conector, /"SOLICITAR_REEMBOLSO"/);
  assert.match(conector, /"HEALTH_CHECK"/);
});

test("conector.ts agrega obtenerConectorPorId() descifrando credenciales", () => {
  assert.match(conector, /export async function obtenerConectorPorId\(id: string\)/);
  const cuerpo = conector.slice(conector.indexOf("export async function obtenerConectorPorId"));
  assert.match(cuerpo, /decrypt\(\{ ciphertext: conector\.access_token_cifrado/);
  assert.match(cuerpo, /CONECTOR_NO_ENCONTRADO/);
});

// ──────────────────────────────────────────────────────────────────────────────
// adapter.ts (R1.3) — solicitarReembolso + healthCheck
// ──────────────────────────────────────────────────────────────────────────────

test("adapter.ts exporta solicitarReembolso y healthCheck", () => {
  assert.match(adapter, /export async function solicitarReembolso\(\s*paymentId: string,\s*idempotencyKey: string,\s*monto\?: number,/);
  assert.match(adapter, /Promise<ReembolsoSolicitado>/);
  assert.match(adapter, /export async function healthCheck\(input: HealthCheckInput\)/);
});

test("solicitarReembolso usa POST /v1/payments/{id}/refunds y transmite la key del caller", () => {
  assert.match(adapter, /"SOLICITAR_REEMBOLSO"/);
  assert.match(adapter, /`\/v1\/payments\/\$\{encodeURIComponent\(paymentId\)\}\/refunds`/);
  assert.match(adapter, /monto === undefined \? undefined : \{ amount: monto \}/);
  assert.match(adapter, /"X-Idempotency-Key": idempotencyKey \?\? randomUUID\(\)/);
  assert.match(adapter, /undefined,\s*idempotencyKey,/);
});

test("rama simulada del reembolso es determinística y no toca simulador.ts", () => {
  const cuerpo = adapter.slice(adapter.indexOf("export async function solicitarReembolso"));
  assert.match(cuerpo, /simuladorActivo\(\)/);
  assert.match(cuerpo, /createHash\("sha256"\)\.update\(`\$\{paymentId\}:\$\{idempotencyKey\}`\)/);
  assert.match(cuerpo, /`SIM-REF-\$\{refundId\}`/);
  assert.match(cuerpo, /status: "approved"/);
});

test("mapearEstadoReembolso mapea approved/rejected a estados de dominio", () => {
  assert.match(adapter, /export function mapearEstadoReembolso\(statusMp: string\): EstadoReembolsoDominio/);
  const cuerpo = adapter.slice(adapter.indexOf("export function mapearEstadoReembolso"));
  assert.match(cuerpo, /"approved"/);
  assert.match(cuerpo, /"rejected"/);
});

test("healthCheck llama GET /v1/payment_methods a través del Adapter y es determinístico en simulado", () => {
  const cuerpo = adapter.slice(adapter.indexOf("export async function healthCheck"));
  assert.match(cuerpo, /"HEALTH_CHECK", "GET", "\/v1\/payment_methods"/);
  assert.match(cuerpo, /includes\("INVALID"\)/);
});

test("llamarMercadoPago acepta credenciales explícitas por ctx (HU-F1)", () => {
  assert.match(adapter, /ctx\?: ContextoConector/);
  assert.match(adapter, /await obtenerConectorActivo\(\)/);
  assert.match(adapter, /ctx\s*\n?\s*\?\s*\{ id: ctx\.conectorId, access_token: ctx\.accessToken \}/);
});

// ──────────────────────────────────────────────────────────────────────────────
// CA R1 — 404 ↦ PAGO_NO_ENCONTRADO para CONSULTAR_PAGO y SOLICITAR_REEMBOLSO
// ──────────────────────────────────────────────────────────────────────────────

test("el mapeo de error 404 sigue vigente y cubre consulta y reembolso", () => {
  const indice = adapter.indexOf("export function codigoErrorPorStatus");
  assert.ok(indice >= 0, "adapter.ts debe exportar codigoErrorPorStatus");
  const cuerpo = adapter.slice(indice, adapter.indexOf("\n}", indice));
  assert.match(cuerpo, /status === 404/);
  assert.match(cuerpo, /operacion === "CONSULTAR_PAGO"/);
  assert.match(cuerpo, /operacion === "SOLICITAR_REEMBOLSO"/);
  assert.match(cuerpo, /return "PAGO_NO_ENCONTRADO"/);
});

test("refund valida payment, key y monto antes de seleccionar simulador o red", () => {
  const cuerpo = adapter.slice(adapter.indexOf("export async function solicitarReembolso"));
  const indiceSimulador = cuerpo.indexOf("simuladorActivo()");
  for (const codigo of ["PAYMENT_ID_INVALIDO", "IDEMPOTENCY_KEY_INVALIDA", "MONTO_REEMBOLSO_INVALIDO"]) {
    const indice = cuerpo.indexOf(codigo);
    assert.ok(indice >= 0 && indice < indiceSimulador, `${codigo} debe validarse antes de cualquier ejecución`);
  }
});

test("errores técnicos exponen señal reintentable y causa discriminada", () => {
  assert.match(adapter, /export class ErrorTecnicoMercadoPago extends ServiceError/);
  assert.match(adapter, /readonly reintentable = true/);
  for (const causa of ["TIMEOUT", "RED", "HTTP_429", "HTTP_5XX", "RESPUESTA_AMBIGUA"]) {
    assert.ok(adapter.includes(`"${causa}"`), `falta causa técnica ${causa}`);
  }
});
