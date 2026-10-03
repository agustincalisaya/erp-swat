/**
 * HU-E1 — Resolución del contexto de la tienda para Route Handlers y Server
 * Components de `app/(tienda)` / `app/api/tienda`: ¿quién opera el carrito?
 *
 *  - Con sesión de Cliente Web (HU-E8, `getSesionClienteWeb`) → la cuenta.
 *  - Sin sesión → visitante identificado por la cookie firmada del carrito.
 *
 * La identidad sale SIEMPRE de cookies validadas server-side, nunca de un
 * parámetro del cliente (mismo principio que spec E §2.9).
 */
import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getSesionClienteWeb, type SesionClienteWeb } from "@/lib/auth/sesion-cliente-web";
import {
  CARRITO_COOKIE_NAME,
  DURACION_COOKIE_CARRITO_DIAS,
  leerCookieCarrito,
  serializarCookieCarrito,
} from "@/lib/services/ecommerce/carrito-token";
import type { ContextoCarrito } from "@/lib/services/ecommerce/carrito.service";

export interface ContextoTienda {
  sesion: SesionClienteWeb | null;
  carrito: ContextoCarrito;
  /** Token del carrito de visitante presente en la cookie (aunque haya sesión). */
  carritoTokenVisitante: string | null;
}

export async function resolverContextoTienda(): Promise<ContextoTienda> {
  const [sesion, almacen] = await Promise.all([getSesionClienteWeb(), cookies()]);
  const token = leerCookieCarrito(almacen.get(CARRITO_COOKIE_NAME)?.value);
  return {
    sesion,
    carrito: sesion && !sesion.vinculacionPendiente ? { cuentaId: sesion.cuentaId } : { carritoToken: token },
    carritoTokenVisitante: token,
  };
}

export function aplicarCookieCarrito(response: NextResponse, token: string): void {
  response.cookies.set(CARRITO_COOKIE_NAME, serializarCookieCarrito(token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: DURACION_COOKIE_CARRITO_DIAS * 24 * 60 * 60,
    path: "/",
  });
}

export function borrarCookieCarrito(response: NextResponse): void {
  response.cookies.delete(CARRITO_COOKIE_NAME);
}
