/**
 * @module with-permission
 * @description Higher-order wrapper para Route Handlers de Next.js que garantiza
 * autenticación y, opcionalmente, verificación de permisos RBAC.
 *
 * `usuarioTienePermiso()`/`withPermission()` (task_cali_auditoria_forense.md)
 * resuelven permisos consultando `UsuarioRol → RolPermiso → Permiso` EN CADA
 * LLAMADA — nunca cacheado en sesión/token (spec_modulo_D.md §3.3: una
 * revocación de permiso debe tener efecto inmediato en el siguiente
 * request). El CRUD de `Rol`/`Permiso` en sí (alta, edición de permisos de
 * un rol) es una tarea separada — esto solo resuelve la pregunta de
 * lectura "¿este usuario tiene el código X hoy".
 */
import "server-only";

import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

/**
 * Código del permiso que habilita administrar roles/permisos y, desde la
 * corrección de "Caminos A/B/C" (task_cali_roles_permisos.md, ronda
 * posterior al cierre de la tarea de Roles/Permisos), también dar de baja
 * o suspender/bloquear usuarios — reutilizado deliberadamente en vez de
 * crear un permiso separado (`usuarios:administrar`), por decisión
 * explícita: ambas operaciones son "quién puede alterar quién tiene acceso
 * administrativo al sistema", y hoy solo existe un rol superusuario.
 */
export const PERMISO_ROLES_ADMINISTRAR = "roles:administrar";

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

/**
 * Resuelve si un usuario tiene un permiso RBAC vigente, consultando
 * `UsuarioRol → RolPermiso → Permiso` en tiempo real (sin cachear).
 *
 * Las tres relaciones deben estar `is_active: true` — un rol suspendido,
 * un permiso removido de un rol, o un permiso dado de baja, invalidan el
 * acceso de inmediato en el siguiente request.
 *
 * @param usuarioId - `usuario_id` de la sesión autenticada.
 * @param codigo - Código exacto del permiso (`Permiso.codigo`), ej.
 *                 `"auditoria:leer_forense"`.
 */
export async function usuarioTienePermiso(usuarioId: string, codigo: string): Promise<boolean> {
  const match = await prisma.usuarioRol.findFirst({
    where: {
      usuario_id: usuarioId,
      is_active: true,
      rol: {
        is_active: true,
        permisos: {
          some: {
            is_active: true,
            permiso: { codigo, is_active: true },
          },
        },
      },
    },
    select: { id: true },
  });

  return match !== null;
}

/**
 * Envuelve un Route Handler exigiendo sesión activa Y un permiso RBAC
 * específico. Devuelve 401 sin sesión, 403 si la sesión es válida pero
 * carece del permiso — usar para endpoints que deben rechazar el acceso
 * por completo sin el permiso (ej. `POST /api/auditoria/verificar-cadena`).
 *
 * No usar para endpoints donde la falta de permiso solo cambia el
 * comportamiento (ej. forzar un filtro) en vez de bloquear el acceso — esa
 * lógica vive en la capa de servicio, no acá (task_cali_auditoria_forense.md §4.1).
 *
 * @param codigo - Código del permiso requerido (`Permiso.codigo`).
 * @param handler - Handler autenticado y autorizado que recibe req y session.
 */
export function withPermission(codigo: string, handler: AuthenticatedHandler) {
  return withAuth(async (req, session) => {
    const autorizado = await usuarioTienePermiso(session.userId, codigo);

    if (!autorizado) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "No tenés el permiso requerido para realizar esta acción",
          },
        },
        { status: 403 },
      );
    }

    return handler(req, session);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// "Administrador funcional" — único punto de verdad (Caminos A/B/C,
// task_cali_roles_permisos.md, ronda de corrección posterior al cierre de
// la tarea de Roles/Permisos).
//
// A diferencia de `usuarioTienePermiso()` (que solo mira si la CADENA
// UsuarioRol→Rol→RolPermiso→Permiso está `is_active`, sin importar el
// estado de la cuenta del propio usuario — correcto para esa función,
// porque ahí el usuario ya pasó por `getServerSession()`/`withAuth`, que
// YA garantiza que su propia cuenta está ACTIVA), acá evaluamos la cuenta
// de un TERCERO (el rol que se está editando, o el usuario que se está
// dando de baja/suspendiendo) — nadie garantiza de antemano que esa
// persona esté operativa. Por eso el filtro exige explícitamente
// `Usuario.estado === "ACTIVO"` e `is_active === true`: un usuario
// suspendido, bloqueado o dado de baja NO cuenta como respaldo, aunque su
// fila `UsuarioRol` siga técnicamente activa a nivel de tabla pivote
// (Camino C — antes de esta corrección, la guarda de
// `actualizarPermisosRol()` no hacía esta distinción).
// ──────────────────────────────────────────────────────────────────────────────

function filtroAdministradorFuncional(codigo: string): Prisma.UsuarioRolWhereInput {
  return {
    is_active: true,
    usuario: { is_active: true, deleted_at: null, estado: "ACTIVO" },
    rol: {
      is_active: true,
      permisos: {
        some: {
          is_active: true,
          permiso: { codigo, is_active: true },
        },
      },
    },
  };
}

export interface ContarAdministradoresFuncionalesOptions {
  /** Excluir asignaciones a través de este rol (ej. el rol que se está editando). */
  excluirRolId?: string;
  /** Excluir TODAS las asignaciones de este usuario (ej. el usuario que se está dando de baja/suspendiendo). */
  excluirUsuarioId?: string;
}

/**
 * Cuenta cuántas asignaciones `UsuarioRol` activas, a usuarios genuinamente
 * operativos (`estado: "ACTIVO"`, `is_active: true`), otorgan el permiso
 * `codigo` — opcionalmente excluyendo un rol o un usuario específico del
 * conteo (la operación que se está evaluando).
 *
 * @param codigo - Código del permiso a verificar (ej. `PERMISO_ROLES_ADMINISTRAR`).
 * @param options - Exclusiones a aplicar antes de contar.
 * @param db - Cliente de transacción del llamador, si la operación debe ser
 *             atómica junto con la escritura que depende de este conteo
 *             (Camino B — evita condiciones de carrera entre dos
 *             operaciones concurrentes que remueven el permiso desde
 *             fuentes distintas). Default: `prisma` (uso standalone).
 */
export async function contarAdministradoresFuncionales(
  codigo: string,
  options: ContarAdministradoresFuncionalesOptions = {},
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return db.usuarioRol.count({
    where: {
      ...filtroAdministradorFuncional(codigo),
      ...(options.excluirRolId ? { rol_id: { not: options.excluirRolId } } : {}),
      ...(options.excluirUsuarioId ? { usuario_id: { not: options.excluirUsuarioId } } : {}),
    },
  });
}

/**
 * Responde si un usuario específico es HOY un administrador funcional del
 * permiso `codigo` — es decir, si remover/suspender a esta persona
 * puntualmente reduciría el conteo de `contarAdministradoresFuncionales()`.
 * Si la persona ya está suspendida/bloqueada/inactiva, o no tiene el
 * permiso, no es "funcional" y esta función devuelve `false` — la guarda
 * que la use no debe aplicar en ese caso (evita bloquear de más una
 * operación sobre alguien que de todos modos no contaba como respaldo).
 *
 * @param db - Cliente de transacción del llamador, ver `contarAdministradoresFuncionales`.
 */
export async function esAdministradorFuncional(
  usuarioId: string,
  codigo: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const match = await db.usuarioRol.findFirst({
    where: { ...filtroAdministradorFuncional(codigo), usuario_id: usuarioId },
    select: { id: true },
  });

  return match !== null;
}
