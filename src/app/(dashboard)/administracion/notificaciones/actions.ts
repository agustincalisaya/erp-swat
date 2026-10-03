"use server";

/**
 * @module actions — plantillas de notificación (HU-F2, spec_modulo_F.md §2.2)
 * @description Server Actions equivalentes a
 * `POST /api/notificaciones/plantillas`,
 * `PATCH /api/notificaciones/plantillas/[id]`,
 * `PATCH /api/notificaciones/plantillas/[id]/baja` y
 * `PATCH /api/notificaciones/plantillas/[id]/reactivar` (task §4.1-bis),
 * para la pantalla de gestión del Administrador de Plataforma.
 *
 * Wrappers finos (spec F §1): sesión + permiso
 * `notificaciones:administrar_plantillas`, parseo Zod, misma función de
 * servicio que el Route Handler equivalente y shape plano `{ data, error }`.
 * Sin lógica de negocio acá — vive en `plantilla-notificacion.service.ts`.
 * Sufijo `Action` para no chocar con las funciones homónimas del servicio
 * (patrón HU-B4/B5/B9).
 *
 * Sin `revalidatePath`: la pantalla se refresca con el `router.refresh()` del
 * cliente antes de cerrar cada Dialog (task §6, lección HU-H9), un único
 * disparador de refetch (lección HU-G10, commit a092282).
 */
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  CrearPlantillaNotificacionSchema,
  DarDeBajaPlantillaNotificacionSchema,
  EditarPlantillaNotificacionBodySchema,
  errorEdicion,
  PlantillaNotificacionIdSchema,
} from "@/lib/schemas/notificaciones.schema";
import {
  crearPlantillaNotificacion,
  darDeBajaPlantillaNotificacion,
  editarPlantillaNotificacion,
  PERMISO_ADMINISTRAR_PLANTILLAS,
  reactivarPlantillaNotificacion,
  type PlantillaNotificacionCreada,
  type PlantillaNotificacionDadaDeBaja,
  type PlantillaNotificacionEditada,
  type PlantillaNotificacionReactivada,
} from "@/lib/services/notificaciones/plantilla-notificacion.service";

export type ActionError = { code: string; message: string };
export type ActionResult<T> = { data: T; error: null } | { data: null; error: ActionError };

function fallo(code: string, message: string): { data: null; error: ActionError } {
  return { data: null, error: { code, message } };
}

async function verificarAcceso(): Promise<{ userId: string } | { data: null; error: ActionError }> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_ADMINISTRAR_PLANTILLAS))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_ADMINISTRAR_PLANTILLAS}"`);
  }
  return { userId: session.userId };
}

function falloInesperado(accion: string, err: unknown): { data: null; error: ActionError } {
  if (err instanceof ServiceError) return fallo(err.code, err.message);
  console.error(`[${accion}] Error inesperado:`, err);
  return fallo("INTERNAL_ERROR", "Error interno del servidor");
}

/** Server Action equivalente a `POST /api/notificaciones/plantillas` (task §4.1). */
export async function crearPlantillaNotificacionAction(
  input: unknown,
): Promise<ActionResult<PlantillaNotificacionCreada>> {
  const acceso = await verificarAcceso();
  if (!("userId" in acceso)) return acceso;

  const parsed = CrearPlantillaNotificacionSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await crearPlantillaNotificacion(parsed.data, acceso.userId);
    return { data, error: null };
  } catch (err) {
    return falloInesperado("crearPlantillaNotificacionAction", err);
  }
}

/** Server Action equivalente a `PATCH /api/notificaciones/plantillas/[id]` (task §4.2). */
export async function editarPlantillaNotificacionAction(
  plantillaId: unknown,
  input: unknown,
): Promise<ActionResult<PlantillaNotificacionEditada>> {
  const acceso = await verificarAcceso();
  if (!("userId" in acceso)) return acceso;

  const parsedId = PlantillaNotificacionIdSchema.safeParse(plantillaId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = EditarPlantillaNotificacionBodySchema.safeParse(input);
  if (!parsed.success) return { data: null, error: errorEdicion(parsed.error) };

  try {
    const data = await editarPlantillaNotificacion(parsedId.data, parsed.data, acceso.userId);
    return { data, error: null };
  } catch (err) {
    return falloInesperado("editarPlantillaNotificacionAction", err);
  }
}

/** Server Action equivalente a `PATCH /api/notificaciones/plantillas/[id]/baja` (task §4.3). */
export async function darDeBajaPlantillaNotificacionAction(
  plantillaId: unknown,
  input: unknown,
): Promise<ActionResult<PlantillaNotificacionDadaDeBaja>> {
  const acceso = await verificarAcceso();
  if (!("userId" in acceso)) return acceso;

  const parsedId = PlantillaNotificacionIdSchema.safeParse(plantillaId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = DarDeBajaPlantillaNotificacionSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const data = await darDeBajaPlantillaNotificacion(parsedId.data, parsed.data, acceso.userId);
    return { data, error: null };
  } catch (err) {
    return falloInesperado("darDeBajaPlantillaNotificacionAction", err);
  }
}

/** Server Action equivalente a `PATCH /api/notificaciones/plantillas/[id]/reactivar` (task §4.1-bis). */
export async function reactivarPlantillaNotificacionAction(
  plantillaId: unknown,
): Promise<ActionResult<PlantillaNotificacionReactivada>> {
  const acceso = await verificarAcceso();
  if (!("userId" in acceso)) return acceso;

  const parsedId = PlantillaNotificacionIdSchema.safeParse(plantillaId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  try {
    const data = await reactivarPlantillaNotificacion(parsedId.data, acceso.userId);
    return { data, error: null };
  } catch (err) {
    return falloInesperado("reactivarPlantillaNotificacionAction", err);
  }
}
