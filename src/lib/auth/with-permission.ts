/**
 * @module with-permission
 * @description Higher-order wrapper para Route Handlers de Next.js que garantiza
 * autenticación y, opcionalmente, verificación de permisos RBAC.
 *
 * Estado actual: verifica autenticación básica (sesión activa).
 * @todo HU-D: añadir verificación de permisos granulares (codigo: string) contra
 *       la tabla `permisos` del sistema RBAC.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";

type AuthenticatedHandler = (
  req: NextRequest,
  session: { userId: string; nombreUsuario: string },
) => Promise<NextResponse>;

/**
 * Envuelve un Route Handler exigiendo sesión activa.
 * Devuelve 401 si no hay sesión válida.
 *
 * Compatible con Next.js 16 App Router donde `context.params` es `Promise<...>`.
 *
 * @param handler - Handler autenticado que recibe req y session.
 * @returns Route Handler compatible con Next.js App Router.
 *
 * @example
 * export const POST = withAuth(async (req, session) => {
 *   // session.userId garantizado
 * });
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest, _ctx: unknown): Promise<NextResponse> => {
    const session = await getServerSession();

    if (!session) {
      return NextResponse.json(
        { data: null, error: { code: "UNAUTHORIZED", message: "Sesión requerida" } },
        { status: 401 },
      );
    }

    return handler(req, session);
  };
}
