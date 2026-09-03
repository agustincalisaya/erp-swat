import "server-only";

/**
 * @module aes
 * @description Cifrado AES-256-GCM para datos sensibles en reposo (HU-H1,
 * spec_modulo_H.md §3.3 · RULES.md Regla N.° 2 · Ley N.° 25.326). ÚNICO punto
 * de cifrado/descifrado de los datos bancarios del legajo de Proveedor — los
 * Route Handlers, Server Actions y componentes de UI nunca cifran ni
 * descifran directamente; solo la capa de servicios
 * (`proveedor.service.ts`) invoca `encrypt()`/`decrypt()`.
 *
 * Formato de almacenamiento (decisión D1 del design):
 *  - `ciphertext = hex(tag ‖ ct)`: el tag GCM viaja DENTRO del ciphertext
 *    porque el schema de `Proveedor` tiene solo dos columnas
 *    (`datos_bancarios_cifrado` / `datos_bancarios_iv`).
 *  - `iv = randomBytes(12)` en hex, generado aleatorio por cada operación.
 *
 * La clave `ENCRYPTION_KEY_PROVEEDORES` (64 caracteres hex = 32 bytes) se
 * valida de forma LAZY, al primer uso — mismo patrón que `lib/auth/jwt.ts`
 * `resolveSecret`: el módulo puede importarse sin que el entorno esté
 * completo, pero ninguna operación de cifrado funciona sin la clave.
 *
 * El valor en claro NUNCA se loguea, ni viaja en payloads de eventos ni en
 * respuestas HTTP (spec §3.3).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
/** 12 bytes = tamaño estándar del IV/Nonce de GCM. */
const TAMANIO_IV = 12;
/** 16 bytes = tamaño del tag de autenticación GCM (128 bits). */
const TAMANIO_TAG = 16;

function resolveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY_PROVEEDORES;

  if (!raw) {
    throw new Error(
      "[AES] La variable de entorno ENCRYPTION_KEY_PROVEEDORES no está definida. " +
        "Generá una clave con `openssl rand -hex 32` e inyectala en el entorno.",
    );
  }

  if (raw.length !== 64) {
    throw new Error(
      `[AES] ENCRYPTION_KEY_PROVEEDORES debe tener exactamente 64 caracteres ` +
        `hexadecimales (32 bytes). Longitud actual: ${raw.length}.`,
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "[AES] ENCRYPTION_KEY_PROVEEDORES contiene caracteres no hexadecimales.",
    );
  }

  return Buffer.from(raw, "hex");
}

export interface DatoCifrado {
  /** hex(tag ‖ ct) — el tag GCM viaja dentro del ciphertext (decisión D1). */
  ciphertext: string;
  /** IV aleatorio de 12 bytes, en hex. */
  iv: string;
}

/**
 * Cifra un valor en claro con AES-256-GCM.
 *
 * @param plaintext - Valor en claro (ej. `JSON.stringify(datos_bancarios)`).
 * @returns `{ ciphertext, iv }` — nunca el valor en claro.
 */
export function encrypt(plaintext: string): DatoCifrado {
  const key = resolveKey();
  const iv = randomBytes(TAMANIO_IV);
  const cipher = createCipheriv(ALGORITMO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([tag, ct]).toString("hex"),
    iv: iv.toString("hex"),
  };
}

/**
 * Descifra un valor previamente cifrado con `encrypt()`.
 *
 * @param payload - `{ ciphertext, iv }` tal como se persistió.
 * @returns El valor en claro original.
 */
export function decrypt(payload: DatoCifrado): string {
  const key = resolveKey();
  const iv = Buffer.from(payload.iv, "hex");
  const tagYct = Buffer.from(payload.ciphertext, "hex");
  const tag = tagYct.subarray(0, TAMANIO_TAG);
  const ct = tagYct.subarray(TAMANIO_TAG);
  const decipher = createDecipheriv(ALGORITMO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}