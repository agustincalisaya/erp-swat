/**
 * @module password
 * @description Punto de entrada de derivación/verificación de credenciales
 * con Argon2id para el resto de la aplicación (Route Handlers, Server
 * Actions, services).
 *
 * Cumplimiento normativo:
 *  - RULES.md §2 — Protección de Datos Personales: la contraseña en texto
 *    plano nunca se persiste ni se loguea; solo su hash derivado.
 *  - spec_modulo_D.md §3.1 — Ningún Route Handler, Server Action ni otro
 *    service invoca la librería de hashing directamente: todo pasa por acá.
 *
 * La implementación real (algoritmo, constantes de costo) vive en
 * `lib/auth/password-hash-core.ts`, que deliberadamente NO tiene el guard
 * `server-only` para poder importarse también desde `prisma/seed.ts`
 * (ejecutado vía `tsx` plano, fuera del bundler de Next.js) sin reimplementar
 * el hashing ahí. Este módulo reexporta exactamente esa misma
 * implementación con el guard puesto, para que el código de aplicación
 * conserve la protección contra un import accidental desde un Client
 * Component.
 */
import "server-only";

export { hashPassword, verifyPassword, type PasswordHash } from "./password-hash-core";
