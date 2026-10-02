/**
 * @module sesion-cliente-web
 * @description HU-E8 — Sesión de Cliente Web (spec_modulo_E.md §2.8).
 *
 * TODO(HU-E8): MÍNIMO PROVISIONAL introducido por HU-E1 (aprobado por el
 * owner) para cubrir el CA6 de E1 ("iniciar el checkout exige sesión de
 * Cliente Web"). Todo lo de HU-E8 vive en ESTE único módulo para que el owner
 * de HU-E8 lo reemplace sin tocar el código de HU-E1: E1 solo consume
 * `iniciarSesionClienteWeb()`, `getSesionClienteWeb()`, `withSesionClienteWeb()`,
 * `aplicarCookieSesionClienteWeb()` y `borrarCookieSesionClienteWeb()`.
 *
 * Lo que SÍ cumple ya del contrato de spec E §2.8:
 *  - Separada del RBAC interno: JWT propio, secreto distinto
 *    (`JWT_SECRET_CLIENTE_WEB`) y cookie distinta (`swat_tienda_session`). Un
 *    token de Cliente Web nunca valida contra `verificarSesionJwt()` del ERP.
 *  - Claim `tv` (`token_version`) verificado contra `CuentaClienteWeb` en cada
 *    request: incrementarlo revoca todas las sesiones emitidas antes.
 *  - Contraseña verificada con argon2id vía `lib/auth/password.ts`.
 *
 * TODO(HU-E8) — fuera de este mínimo: registro, bloqueo por intentos fallidos
 * (`intentos_fallidos`/`bloqueada_hasta` solo se LEEN acá, no se incrementan),
 * blanqueo presencial, baja de cuenta, eventos auditados de la cuenta.
 */
import "server-only";

import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { autenticarCuentaClienteWeb } from "@/lib/services/ecommerce/cuenta-cliente-web.service";

export const SESION_CLIENTE_WEB_COOKIE_NAME = "swat_tienda_session";

// TODO(HU-E8): duración de la sesión de Cliente Web — la spec no la fija.
export const DURACION_SESION_CLIENTE_WEB_HORAS = 24 * 7;

const JWT_ALGORITHM = "HS256";
const JWT_AUDIENCE = "tienda";

export interface SesionClienteWeb {
  cuentaId: string;
  clienteId: string;
  email: string;
  /** spec E §2.8: con vinculación pendiente la cuenta no puede iniciar checkout. */
  vinculacionPendiente: boolean;
}

function resolverSecreto(): Uint8Array {
  const raw = process.env.JWT_SECRET_CLIENTE_WEB;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "[sesion-cliente-web] JWT_SECRET_CLIENTE_WEB debe estar definida con 64 caracteres hexadecimales " +
        "(openssl rand -hex 32) y ser DISTINTA de JWT_SECRET.",
    );
  }
  if (raw === process.env.JWT_SECRET) {
    throw new Error("[sesion-cliente-web] JWT_SECRET_CLIENTE_WEB no puede ser igual a JWT_SECRET.");
  }
  return Buffer.from(raw, "hex");
}

async function firmarJwt(cuentaId: string, tokenVersion: number, expiraEn: Date): Promise<string> {
  return new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(cuentaId)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiraEn.getTime() / 1000))
    .sign(resolverSecreto());
}

async function verificarJwt(token: string): Promise<{ cuentaId: string; tokenVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, resolverSecreto(), {
      algorithms: [JWT_ALGORITHM],
      audience: JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.tv !== "number") return null;
    return { cuentaId: payload.sub, tokenVersion: payload.tv };
  } catch {
    return null;
  }
}

/** Cuenta + Cliente activos, con la `token_version` vigente. */
async function cargarCuentaActiva(cuentaId: string) {
  return prisma.cuentaClienteWeb.findFirst({
    where: {
      id: cuentaId,
      is_active: true,
      deleted_at: null,
      cliente: { is_active: true, deleted_at: null },
    },
    select: {
      id: true,
      cliente_id: true,
      email: true,
      password_hash: true,
      token_version: true,
      bloqueada_hasta: true,
      vinculacion_pendiente: true,
    },
  });
}

export interface LoginClienteWebResultado {
  sesion: SesionClienteWeb;
  jwt: string;
  expiraEn: Date;
}

/**
 * Valida credenciales y emite el JWT. Mismo error para email inexistente y
 * contraseña incorrecta (no revela qué cuentas existen).
 *
 * @throws {ServiceError} CREDENCIALES_INVALIDAS | CUENTA_BLOQUEADA
 */
export async function iniciarSesionClienteWeb(email: string, password: string): Promise<LoginClienteWebResultado> {
  const cuenta = await autenticarCuentaClienteWeb(email, password);
  const expiraEn = new Date(Date.now() + DURACION_SESION_CLIENTE_WEB_HORAS * 60 * 60 * 1000);
  return {
    sesion: {
      cuentaId: cuenta.cuentaId,
      clienteId: cuenta.clienteId,
      email: cuenta.email,
      vinculacionPendiente: cuenta.vinculacionPendiente,
    },
    jwt: await firmarJwt(cuenta.cuentaId, cuenta.tokenVersion, expiraEn),
    expiraEn,
  };
}

/**
 * Sesión de Cliente Web a partir de la cookie, o `null`. Revalida contra la
 * base en cada request: cuenta/cliente activos y `token_version` vigente.
 */
export async function getSesionClienteWeb(): Promise<SesionClienteWeb | null> {
  const token = (await cookies()).get(SESION_CLIENTE_WEB_COOKIE_NAME)?.value;
  if (!token) return null;

  const jwt = await verificarJwt(token);
  if (!jwt) return null;

  const cuenta = await cargarCuentaActiva(jwt.cuentaId);
  if (!cuenta || cuenta.token_version !== jwt.tokenVersion) return null;

  return {
    cuentaId: cuenta.id,
    clienteId: cuenta.cliente_id,
    email: cuenta.email,
    vinculacionPendiente: cuenta.vinculacion_pendiente,
  };
}

export async function getSesionClienteWebVinculada(): Promise<SesionClienteWeb | null> {
  const sesion = await getSesionClienteWeb();
  return sesion?.vinculacionPendiente ? null : sesion;
}

type HandlerConSesionClienteWeb<C> = (
  req: NextRequest,
  sesion: SesionClienteWeb,
  ctx: C,
) => Promise<NextResponse>;

/**
 * Guard de rutas `app/api/tienda/**` que exigen sesión de Cliente Web
 * (spec E, convenciones generales). NO es `withPermission` del RBAC interno.
 * Sin sesión válida responde `401 SESION_CLIENTE_WEB_REQUERIDA`.
 */
export function withSesionClienteWeb<C = unknown>(
  handler: HandlerConSesionClienteWeb<C>,
  options: { permitirPendiente?: boolean } = {},
) {
  return async (req: NextRequest, ctx: C): Promise<NextResponse> => {
    const sesion = await getSesionClienteWeb();
    if (!sesion) {
      return NextResponse.json(
        { data: null, error: { code: "SESION_CLIENTE_WEB_REQUERIDA", message: "Debe iniciar sesión para completar la compra" } },
        { status: 401 },
      );
    }
    if (sesion.vinculacionPendiente && !options.permitirPendiente) {
      return NextResponse.json(
        { data: null, error: { code: "CUENTA_VINCULACION_PENDIENTE", message: "Tu cuenta está pendiente de validación de identidad en sucursal" } },
        { status: 403 },
      );
    }
    return handler(req, sesion, ctx);
  };
}

/** El JWT nunca va en el body: solo en cookie httpOnly. */
export function aplicarCookieSesionClienteWeb(response: NextResponse, jwt: string): void {
  response.cookies.set(SESION_CLIENTE_WEB_COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // `lax` (no `strict`): el cliente vuelve a la tienda desde links externos
    // (ej. retorno de Mercado Pago en HU-E2) y debe seguir logueado.
    sameSite: "lax",
    maxAge: DURACION_SESION_CLIENTE_WEB_HORAS * 60 * 60,
    path: "/",
  });
}

export function borrarCookieSesionClienteWeb(response: NextResponse): void {
  response.cookies.delete(SESION_CLIENTE_WEB_COOKIE_NAME);
}
