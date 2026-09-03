import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Tests source-regex sobre `lib/crypto/aes.ts` (mismo patrón que
 * `evaluacion.service.test.ts` — sin mock de prisma ni de node:crypto):
 * verifican los contratos del design D1 y de la spec §3.3 leyendo la fuente.
 */

const fuente = readFileSync(new URL("./aes.ts", import.meta.url), "utf8");

test("usa AES-256-GCM (aes-256-gcm) como algoritmo de cifrado", () => {
  assert.match(fuente, /aes-256-gcm/);
});

test("genera un IV aleatorio de 12 bytes por cada operación de cifrado", () => {
  assert.match(fuente, /randomBytes\(12\)/);
  assert.match(fuente, /randomBytes\(TAMANIO_IV\)/);
});

test("el ciphertext almacena hex(tag ‖ ct): el tag GCM viaja dentro del ciphertext", () => {
  assert.match(fuente, /getAuthTag/);
  assert.match(fuente, /Buffer\.concat\(\[tag, ct\]\)\.toString\("hex"\)/);
  assert.match(fuente, /createCipheriv\(ALGORITMO, key, iv\)/);
});

test("la clave se valida de forma LAZY (patrón resolveSecret de jwt.ts): nunca en import-time", () => {
  // La lectura del env vive dentro de una función (`resolveKey`), no a nivel
  // de módulo — importar el módulo sin la variable no debe lanzar.
  assert.match(fuente, /function resolveKey\(\)/);
  assert.match(fuente, /process\.env\.ENCRYPTION_KEY_PROVEEDORES/);
  const indiceFuncion = fuente.indexOf("function resolveKey()");
  const indiceEnv = fuente.indexOf("process.env.ENCRYPTION_KEY_PROVEEDORES");
  assert.ok(indiceEnv > indiceFuncion);
});

test("valida la clave como 64 caracteres hexadecimales (32 bytes)", () => {
  assert.match(fuente, /raw\.length !== 64/);
  assert.match(fuente, /\^\[0-9a-fA-F\]\{64\}\$/);
});

test("la clave se convierte a Buffer desde hex (Buffer.from(raw, 'hex'))", () => {
  assert.match(fuente, /Buffer\.from\(raw, "hex"\)/);
});

test("decrypt reconstruye el plaintext separando tag (16 bytes) del ciphertext", () => {
  assert.match(fuente, /createDecipheriv\(ALGORITMO, key, iv\)/);
  assert.match(fuente, /setAuthTag\(tag\)/);
  assert.match(fuente, /subarray\(0, TAMANIO_TAG\)/);
});

test("el módulo no loguea valores en claro ni usa console", () => {
  assert.doesNotMatch(fuente, /console\./);
});

test("no hay ninguna segunda implementación de cifrado: un solo módulo AES", () => {
  // Sin duplicar primitivas criptográficas fuera de este archivo (mismo
  // criterio de centralización que `lib/auth/jwt.ts` / `lib/auth/password.ts`).
  assert.match(fuente, /server-only/);
});