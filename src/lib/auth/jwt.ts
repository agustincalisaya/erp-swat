/**
 * @module jwt
 * @description Firma y verificación del JWT de sesión (HU-3, spec_modulo_D.md §3).
 *
 * Ningún otro módulo debe invocar `jose` directamente para firmar/verificar
 * el JWT de sesión — se centraliza acá, mismo patrón que `lib/auth/password.ts`
 * (Argon2id) y `lib/crypto/aes.ts` (AES-256): primitivas criptográficas
 * versionadas en un único archivo, nunca inline en services/routes.
 *
 * Alcance deliberadamente mínimo: esta función SOLO verifica firma y
 * expiración criptográfica del JWT. NO consulta la tabla `Sesion` (revocada/
 * expira_en) — esa verificación vive exclusivamente en `getServerSession()`
 * (decisión confirmada: `src/proxy.ts` no duplica esa consulta).
 *
 * Variable de entorno requerida: JWT_SECRET (64 caracteres hex = 32 bytes)
 * Generar: openssl rand -hex 32
 */
import "server-only";

import { SignJWT, jwtVerify } from "jose";

const JWT_ALGORITHM = "HS256" as const;

function resolveSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;

  if (!raw) {
    throw new Error(
      "[JWT] La variable de entorno JWT_SECRET no está definida. " +
        "Generá una clave con `openssl rand -hex 32` e inyectala en el entorno.",
    );
  }

  if (raw.length !== 64) {
    throw new Error(
      `[JWT] JWT_SECRET debe tener exactamente 64 caracteres hexadecimales ` +
        `(32 bytes). Longitud actual: ${raw.length}.`,
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("[JWT] JWT_SECRET contiene caracteres no hexadecimales.");
  }

  return Buffer.from(raw, "hex");
}

export interface SesionJwtPayload {
  /** `sub` — usuario_id del titular de la sesión. */
  usuarioId: string;
  /** `jti` — vincula este JWT con su fila en `Sesion.jwt_id`. */
  jti: string;
}

/**
 * Firma un JWT de sesión (HS256). Payload mínimo: `sub`, `jti`, `iat`, `exp`.
 *
 * @param payload - `usuarioId` (→ `sub`) y `jti` (→ `Sesion.jwt_id`).
 * @param expiraEn - Instante exacto de expiración (debe coincidir con
 *                    `Sesion.expira_en` para que ambas fuentes de verdad
 *                    caduquen de forma consistente).
 */
export async function firmarSesionJwt(
  payload: SesionJwtPayload,
  expiraEn: Date,
): Promise<string> {
  const secret = resolveSecret();

  return new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(payload.usuarioId)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiraEn.getTime() / 1000))
    .sign(secret);
}

/**
 * Verifica firma y expiración de un JWT de sesión.
 *
 * @param token - JWT tal como llega en la cookie `swat_session`.
 * @returns `{ usuarioId, jti }` si el JWT es criptográficamente válido y no
 *          expiró; `null` si la firma es incorrecta, expiró, o el payload
 *          no trae `sub`/`jti`. Nunca lanza — el llamador solo necesita
 *          distinguir "válido" de "inválido", no la causa específica.
 */
export async function verificarSesionJwt(token: string): Promise<SesionJwtPayload | null> {
  const secret = resolveSecret();

  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [JWT_ALGORITHM] });

    if (typeof payload.sub !== "string" || typeof payload.jti !== "string") {
      return null;
    }

    return { usuarioId: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}
