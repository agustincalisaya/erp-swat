/**
 * HU-E1 — Token del carrito de visitante (spec_modulo_E.md §2.1: "cookie
 * firmada, sin PII"). La cookie viaja como `<token>.<firma>`; en la base se
 * guarda solo `<token>` (`CarritoWeb.carrito_token`). La firma (HMAC-SHA256
 * con `CARRITO_COOKIE_SECRET`) impide que un tercero adivine o fabrique el
 * token de otro carrito. Sin `server-only` para poder testearlo con node --test.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CARRITO_COOKIE_NAME = "swat_carrito";
/** El carrito de visitante dura lo mismo que una sesión típica de compra larga. */
export const DURACION_COOKIE_CARRITO_DIAS = 30;

function secreto(): Buffer {
  const raw = process.env.CARRITO_COOKIE_SECRET;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "[carrito-token] CARRITO_COOKIE_SECRET debe estar definida con 64 caracteres hexadecimales (openssl rand -hex 32).",
    );
  }
  return Buffer.from(raw, "hex");
}

function firmar(token: string): string {
  return createHmac("sha256", secreto()).update(token).digest("base64url");
}

/** Nuevo token aleatorio (48 hex, sin relación con ningún dato personal). */
export function generarTokenCarrito(): string {
  return randomBytes(24).toString("hex");
}

/** Valor de la cookie para un token. */
export function serializarCookieCarrito(token: string): string {
  return `${token}.${firmar(token)}`;
}

/** Token si la cookie está bien firmada; `null` si falta o fue alterada. */
export function leerCookieCarrito(valor: string | undefined | null): string | null {
  if (!valor) return null;
  const separador = valor.lastIndexOf(".");
  if (separador <= 0) return null;
  const token = valor.slice(0, separador);
  const firma = Buffer.from(valor.slice(separador + 1));
  const esperada = Buffer.from(firmar(token));
  if (firma.length !== esperada.length || !timingSafeEqual(firma, esperada)) return null;
  return /^[0-9a-f]{48}$/.test(token) ? token : null;
}
