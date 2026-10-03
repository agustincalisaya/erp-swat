"use server";

/**
 * @module actions — bandeja de notificaciones (HU-F3, spec_modulo_F.md §2.3)
 * @description Server Actions equivalentes a
 * `PATCH /api/notificaciones/[id]/leer`,
 * `PATCH /api/notificaciones/marcar-todas-leidas` y
 * `PATCH /api/notificaciones/[id]/archivar` (task §4.6), para la página
 * `/notificaciones` del personal interno.
 *
 * Wrappers finos: sesión (sin permiso granular — autorización por propiedad
 * del recurso), destinatario resuelto desde `getServerSession()`, misma
 * función de servicio que el Route Handler y shape plano `{ data, error }`.
 * Sufijo `Action` para no chocar con las funciones homónimas del servicio.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";
import { NotificacionIdSchema } from "@/lib/schemas/notificaciones.schema";
import {
  archivarNotificacion,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  type DestinatarioNotificacion,
  type NotificacionArchivada,
  type NotificacionesMarcadas,
  type NotificacionLeida,
} from "@/lib/services/notificaciones/notificacion.service";

export type ActionError = { code: string; message: string };
export type ActionResult<T> = { data: T; error: null } | { data: null; error: ActionError };

function fallo(code: string, message: string): { data: null; error: ActionError } {
  return { data: null, error: { code, message } };
}

async function resolverDestinatario(): Promise<DestinatarioNotificacion | null> {
  const session = await getServerSession();
  return session ? { tipo: "USUARIO", usuario_id: session.userId } : null;
}

function falloInesperado(accion: string, err: unknown): { data: null; error: ActionError } {
  if (err instanceof ServiceError) return fallo(err.code, err.message);
  console.error(`[${accion}] Error inesperado:`, err);
  return fallo("INTERNAL_ERROR", "Error interno del servidor");
}

/** Server Action equivalente a `PATCH /api/notificaciones/[id]/leer` (task §4.3). */
export async function marcarNotificacionLeidaAction(
  notificacionId: unknown,
): Promise<ActionResult<NotificacionLeida>> {
  const destinatario = await resolverDestinatario();
  if (!destinatario) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = NotificacionIdSchema.safeParse(notificacionId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  try {
    const data = await marcarNotificacionLeida(parsedId.data, destinatario);
    revalidatePath("/notificaciones");
    return { data, error: null };
  } catch (err) {
    return falloInesperado("marcarNotificacionLeidaAction", err);
  }
}

/** Server Action equivalente a `PATCH /api/notificaciones/marcar-todas-leidas` (task §4.4). */
export async function marcarTodasLeidasAction(): Promise<ActionResult<NotificacionesMarcadas>> {
  const destinatario = await resolverDestinatario();
  if (!destinatario) return fallo("UNAUTHORIZED", "Sesión requerida");

  try {
    const data = await marcarTodasLeidas(destinatario);
    revalidatePath("/notificaciones");
    return { data, error: null };
  } catch (err) {
    return falloInesperado("marcarTodasLeidasAction", err);
  }
}

/** Server Action equivalente a `PATCH /api/notificaciones/[id]/archivar` (task §4.5). */
export async function archivarNotificacionAction(
  notificacionId: unknown,
): Promise<ActionResult<NotificacionArchivada>> {
  const destinatario = await resolverDestinatario();
  if (!destinatario) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = NotificacionIdSchema.safeParse(notificacionId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  try {
    const data = await archivarNotificacion(parsedId.data, destinatario);
    revalidatePath("/notificaciones");
    return { data, error: null };
  } catch (err) {
    return falloInesperado("archivarNotificacionAction", err);
  }
}
