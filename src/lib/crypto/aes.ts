/**
 * @module aes
 * @description Servicio criptográfico AES-256-GCM para cifrado de datos sensibles en reposo.
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

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────────
// Constantes del algoritmo
// ──────────────────────────────────────────────────────────────────────────────
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH_BYTES = 12; // GCM recomienda 96 bits (12 bytes) como longitud óptima de IV
const AUTH_TAG_LENGTH_BYTES = 16; // GCM produce un authentication tag de 128 bits (16 bytes)

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
 * Cifra un texto plano usando AES-256-GCM.
 *
 * @param plaintext - Cadena UTF-8 a cifrar.
 * @returns Ciphertext codificado en Base64 con formato: IV || AuthTag || Ciphertext.
 */
export function encrypt(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_LENGTH_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encryptedParts = [cipher.update(plaintext, "utf8"), cipher.final()];
  const encrypted = Buffer.concat(encryptedParts);
  const authTag = cipher.getAuthTag(); // siempre disponible tras cipher.final()

  // Empaquetado: IV (12) || AuthTag (16) || Ciphertext (variable)
  // El IV y el AuthTag son self-contained → no se necesita metadata externa.
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Descifra y verifica la integridad de un ciphertext producido por `encrypt`.
 *
 * @param ciphertext - String Base64 en formato IV || AuthTag || Ciphertext.
 * @returns Texto plano original en UTF-8.
 * @throws Error si el AuthTag no coincide (dato manipulado o clave incorrecta).
 */
export function decrypt(ciphertext: string): string {
  const key = resolveKey();
  const combined = Buffer.from(ciphertext, "base64");

  // Extracción de componentes
  const iv = combined.subarray(0, IV_LENGTH_BYTES);
  const authTag = combined.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const encrypted = combined.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Si el AuthTag no coincide, `decipher.final()` lanzará ERR_CRYPTO_INVALID_AUTH_TAG.
  const decryptedParts = [decipher.update(encrypted), decipher.final()];
  return Buffer.concat(decryptedParts).toString("utf8");
}
