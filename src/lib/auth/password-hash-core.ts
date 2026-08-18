/**
 * @module password-hash-core
 * @description Núcleo puro de derivación/verificación Argon2id — sin el
 * marcador `server-only`, deliberadamente, para que pueda importarse desde
 * contextos que no pasan por el bundler de Next.js (ej. `prisma/seed.ts`,
 * ejecutado vía `tsx` plano por `prisma db seed`).
 *
 * `lib/auth/password.ts` es el punto de entrada para el resto de la app
 * (Route Handlers, Server Actions, services) y reexporta exactamente lo
 * mismo que este archivo, con el guard `server-only` puesto — así el
 * seed reusa el mismo algoritmo sin reimplementarlo, sin que el resto de
 * la aplicación pierda la protección contra un import accidental desde un
 * Client Component.
 *
 * No importar este módulo directamente fuera de `password.ts` o de
 * scripts de seed/mantenimiento — para código de aplicación, usar
 * `@/lib/auth/password`.
 */
import { hash, verify } from "@node-rs/argon2";

// ──────────────────────────────────────────────────────────────────────────────
// Parámetros de costo — versionados acá, nunca hardcodeados en el service
// (spec_modulo_D.md §3.1). Valores alineados a las recomendaciones OWASP
// para Argon2id (memoria 19 MiB, 2 iteraciones, 1 grado de paralelismo).
// ──────────────────────────────────────────────────────────────────────────────
const ARGON2_MEMORY_COST_KIB = 19_456;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;

export interface PasswordHash {
  hash: string;
  salt: string;
}

/**
 * Deriva el hash Argon2id de una contraseña en texto plano.
 *
 * @param plainPassword - Contraseña en texto plano (ya validada por Zod).
 * @returns `{ hash, salt }` a persistir en `Usuario.password_hash` /
 *          `Usuario.password_salt`. La sal viaja embebida en `hash` (formato
 *          PHC); `salt` replica el mismo valor para satisfacer el schema.
 */
export async function hashPassword(plainPassword: string): Promise<PasswordHash> {
  const phcHash = await hash(plainPassword, {
    memoryCost: ARGON2_MEMORY_COST_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });

  return { hash: phcHash, salt: phcHash };
}

/**
 * Verifica una contraseña en texto plano contra el hash PHC persistido.
 *
 * Firma alineada a spec_modulo_D.md §3.1 (`verifyPassword(plain, hash, salt)`).
 * `storedSalt` no se usa: `@node-rs/argon2` embebe la sal dentro de
 * `storedHash` (formato PHC) y la valida internamente en `verify()`. Se
 * conserva el parámetro para no romper el contrato documentado ni forzar a
 * los llamadores a conocer este detalle de implementación de la librería.
 *
 * @param plainPassword - Contraseña recibida en el intento de login.
 * @param storedHash - `Usuario.password_hash` (string PHC completo).
 * @param storedSalt - `Usuario.password_salt` (idéntico a `storedHash`, ver `hashPassword`). No utilizado.
 * @returns `true` si la contraseña es válida, `false` en caso contrario.
 */
export async function verifyPassword(
  plainPassword: string,
  storedHash: string,
  storedSalt?: string,
): Promise<boolean> {
  void storedSalt;
  return verify(storedHash, plainPassword);
}
