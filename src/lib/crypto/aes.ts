/**
 * @module aes
 * @description Servicio criptográfico AES-256-GCM para cifrado/descifrado de
 * datos sensibles en reposo.
 *
 * Cumplimiento normativo:
 *  - Ley N.° 25.326 (Protección de Datos Personales)
 *  - RULES.md §2 — Cifrado AES-256 obligatorio para datos identificatorios de efectivos
 *
 * Algoritmo: AES-256-GCM (AEAD — Authenticated Encryption with Associated Data)
 *  - Autenticación integrada: detecta manipulación del ciphertext sin HMAC adicional.
 *  - IV aleatorio de 12 bytes por operación: imposibilita ataques de repetición.
 *
 * Formato de output: Base64( IV[12 bytes] || AuthTag[16 bytes] || Ciphertext )
 *
 * Variable de entorno requerida: ENCRYPTION_KEY_LEGAJOS (64 caracteres hex = 32 bytes)
 * Generar: openssl rand -hex 32
 */
import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes del algoritmo
// ──────────────────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH_BYTES = 12;        // GCM recomienda 96 bits (12 bytes) como longitud óptima de IV
const AUTH_TAG_LENGTH_BYTES = 16;  // GCM produce un authentication tag de 128 bits (16 bytes)

// ──────────────────────────────────────────────────────────────────────────────
// Resolución de clave — se evalúa en runtime para respetar la inyección de env
// ──────────────────────────────────────────────────────────────────────────────

function resolveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY_LEGAJOS;

  if (!raw) {
    throw new Error(
      "[AES] La variable de entorno ENCRYPTION_KEY_LEGAJOS no está definida. " +
        "Generá una clave con `openssl rand -hex 32` e inyectala en el entorno.",
    );
  }

  if (raw.length !== 64) {
    throw new Error(
      `[AES] ENCRYPTION_KEY_LEGAJOS debe tener exactamente 64 caracteres hexadecimales ` +
        `(32 bytes). Longitud actual: ${raw.length}.`,
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("[AES] ENCRYPTION_KEY_LEGAJOS contiene caracteres no hexadecimales.");
  }

  return Buffer.from(raw, "hex");
}

// ──────────────────────────────────────────────────────────────────────────────
// API pública
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cifra un string en texto plano con AES-256-GCM.
 *
 * @param plaintext - Dato sensible a cifrar (ej. número de placa).
 * @returns String Base64 con formato: IV[12] || AuthTag[16] || Ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_LENGTH_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Formato: IV (12 bytes) + AuthTag (16 bytes) + Ciphertext
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return payload.toString("base64");
}

/**
 * Descifra un string producido por `encrypt()`.
 *
 * @param encryptedText - String Base64 con formato IV || AuthTag || Ciphertext
 * @returns Texto plano original
 * @throws Error si el ciphertext está corrupto, manipulado o la clave es incorrecta.
 */
export function decrypt(encryptedText: string): string {
  const key = resolveKey();
  const payload = Buffer.from(encryptedText, "base64");

  // Extraer los segmentos: IV (12 bytes) + AuthTag (16 bytes) + Ciphertext (resto)
  const minLength = IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;
  if (payload.length <= minLength) {
    throw new Error(
      `[AES] El payload cifrado es demasiado corto (${payload.length} bytes). ` +
        "Probablemente el dato esté corrupto o no fue cifrado con este módulo.",
    );
  }

  const iv = payload.subarray(0, IV_LENGTH_BYTES);
  const authTag = payload.subarray(IV_LENGTH_BYTES, minLength);
  const ciphertext = payload.subarray(minLength);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // GCM verifica el auth tag en `final()` — si el ciphertext fue manipulado,
  // Node.js lanza un Error("Unsupported state or unable to authenticate data").
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
