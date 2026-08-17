/**
 * @module session
 * @description Helper para obtener la sesión del usuario autenticado.
 *
 * Estado actual: implementación mínima para Sprint 1.
 * Lee el `x-user-id` inyectado por el middleware de autenticación de Next.js.
 *
 * @todo HU-D: reemplazar por sesión firmada con JWT/cookies HTTPOnly cifradas
 *       y validación completa de tokens de refresco.
 */
import "server-only";

import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";

export interface ServerSession {
  userId: string;
  nombreUsuario: string;
}

/**
 * Obtiene la sesión del servidor a partir del header `x-user-id` inyectado
 * por el middleware de autenticación.
 *
 * @returns La sesión si el usuario existe y está activo, `null` en caso contrario.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const headersList = await headers();
  const userId = headersList.get("x-user-id");

  if (!userId) return null;

  const usuario = await prisma.usuario.findFirst({
    where: { id: userId, is_active: true, deleted_at: null },
    select: { id: true, nombre_usuario: true },
  });

  if (!usuario) return null;

  return {
    userId: usuario.id,
    nombreUsuario: usuario.nombre_usuario,
  };
}
