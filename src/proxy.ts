/**
 * @module proxy
 * @description Protección de rutas del dashboard (HU-3, task_cali_hu3_login.md §5).
 *
 * Nombre de archivo y export deliberados: en Next.js 16 (versión de este
 * proyecto), `middleware.ts` está DEPRECADO y renombrado a `proxy.ts` — el
 * export debe llamarse `proxy` (o ser default export). Ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
 *
 * Decisión de runtime (confirmada — no re-evaluar): Proxy corre siempre en
 * Node.js runtime en Next 16 (no hay opción de Edge; `runtime` en `config`
 * ni siquiera es una opción válida acá, tirar el error si se intenta
 * setear). Aun así, este archivo SOLO verifica firma/expiración
 * criptográfica del JWT — deliberadamente NO consulta `Sesion` (revocada/
 * expira_en). Esa verificación vive exclusivamente en `getServerSession()`
 * (`lib/auth/session.ts`), para no duplicar la misma query por request.
 *
 * Consecuencia aceptada de este diseño: un JWT recién revocado (ej. por
 * `desactivarUsuario()`) sigue pasando este proxy hasta que expira
 * criptográficamente, PERO cualquier data-fetching real de la página
 * (Server Component / Route Handler) llama a `getServerSession()`, que sí
 * consulta `Sesion` y rechaza en el siguiente request — la revocación de
 * HU-2 sigue siendo instantánea a nivel de datos, el proxy es solo una
 * redirección de conveniencia de UX, no la capa de autorización real.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verificarSesionJwt } from "@/lib/auth/jwt";
import { SESION_COOKIE_NAME } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESION_COOKIE_NAME)?.value;
  const jwtPayload = token ? await verificarSesionJwt(token) : null;

  if (!jwtPayload) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);

    const response = NextResponse.redirect(loginUrl);
    // Cortesía: si había una cookie con un JWT inválido/expirado, se limpia
    // acá. No es la fuente de verdad de revocación (ver nota de módulo).
    if (token) response.cookies.delete(SESION_COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/auditoria/:path*", "/inventario/:path*"],
};
