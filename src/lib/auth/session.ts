/**
 * @module session
 * @description Helper para obtener la sesión del usuario autenticado.
 *
 * HU-3 (task_cali_hu3_login.md §6) — autenticación real vía JWT + tabla
 * `Sesion`, reemplaza por completo el mock de `x-debug-user-id`/`x-user-id`
 * usado para probar HU-1/HU-2. No queda ningún rastro de esos headers acá
 * ni ningún segundo camino de autenticación paralelo al login real.
 *
 * Secuencia de verificación:
 *  1. Lee el JWT de la cookie `swat_session` (httpOnly).
 *  2. Verifica firma y expiración criptográfica (`lib/auth/jwt.ts`).
 *  3. Extrae `jti`, consulta `Sesion` — inválida si no existe, está
 *     `revocada`, o `expira_en < now()`. Esta es la ÚNICA capa que verifica
 *     `Sesion`: `src/proxy.ts` (decisión confirmada) solo valida firma/
 *     expiración del JWT, para no duplicar esta misma consulta dos veces
 *     por request.
 *  4. Si la sesión es válida, consulta `Usuario` por el `sub` del JWT y
 *     verifica `estado === "ACTIVO"` e `is_active === true` — mismo patrón
 *     de verificación activa ya usado (spec_modulo_D.md §3.3), ahora
 *     alimentado por datos reales de login en vez del mock.
 *
 * Esto es lo que hace que la baja lógica de HU-2 siga siendo instantánea
 * con JWT: `desactivarUsuario()` invoca `revocarSesionesDeUsuario()`
 * (`lib/services/auditoria/usuario.service.ts`), así que el siguiente
 * request de un usuario dado de baja falla acá en el paso 3 (sesión
 * revocada), sin depender de que el JWT expire por sí solo.
 */
import "server-only";

import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { verificarSesionJwt } from "@/lib/auth/jwt";

export const SESION_COOKIE_NAME = "swat_session";

export interface ServerSession {
  userId: string;
  nombreUsuario: string;
}

/**
 * Obtiene la sesión del servidor a partir del JWT en la cookie `swat_session`.
 *
 * @returns La sesión si el JWT es válido, la `Sesion` asociada no está
 *          revocada ni expiró, y el `Usuario` sigue `ACTIVO`/`is_active`;
 *          `null` en cualquier otro caso.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESION_COOKIE_NAME)?.value;

  if (!token) return null;

  const jwtPayload = await verificarSesionJwt(token);
  if (!jwtPayload) return null;

  const sesion = await prisma.sesion.findUnique({
    where: { jwt_id: jwtPayload.jti },
    select: { revocada: true, expira_en: true, usuario_id: true },
  });

  if (!sesion || sesion.revocada || sesion.expira_en < new Date()) return null;

  // Defensa en profundidad: el `sub` del JWT debe coincidir con el dueño
  // real de la fila `Sesion` resuelta por `jti` (nunca deberían divergir,
  // salvo manipulación del token, ya descartada por la verificación de
  // firma en `verificarSesionJwt`).
  if (sesion.usuario_id !== jwtPayload.usuarioId) return null;

  const usuario = await prisma.usuario.findFirst({
    where: { id: sesion.usuario_id, is_active: true, deleted_at: null, estado: "ACTIVO" },
    select: { id: true, nombre_usuario: true },
  });

  if (!usuario) return null;

  return {
    userId: usuario.id,
    nombreUsuario: usuario.nombre_usuario,
  };
}
