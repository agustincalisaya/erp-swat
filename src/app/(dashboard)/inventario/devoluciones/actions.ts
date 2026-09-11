"use server";

/**
 * @module devoluciones/actions
 * @description HU-A9 — Server Actions de la UI de Devoluciones
 * (spec_modulo_A.md §2.8/§3.8): reclasificar una unidad DEVUELTO
 * (APTO → DISPONIBLE | NO_APTO → BAJA_MERMA con motivo obligatorio) y
 * aprobar/rechazar solicitudes que superaron el umbral (solo Administrador).
 *
 * Mismo patrón `ActionResult<T>` que el resto de las actions del Módulo A
 * (`variantes/actions.ts`): `getServerSession()` → gate de permiso RBAC
 * (mismo código que la ruta equivalente) → `safeParse` del schema compartido
 * → service → `revalidatePath`. Toda regla de negocio vive en el service.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  RechazarSolicitudSchema,
  ReclasificarDevueltoSchema,
} from "@/lib/schemas/inventario.schema";
import {
  aprobarSolicitud,
  rechazarSolicitud,
  reclasificarDevuelto,
  type ReclasificarDevueltoResultado,
  type SolicitudAprobadaResultado,
  type SolicitudRechazadaResultado,
} from "@/lib/services/inventario/reclasificacion.service";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

/**
 * Reclasifica una unidad DEVUELTO. Mismo gate que la ruta
 * `PATCH /api/inventario/variantes/[id]/reclasificar-devuelto`:
 * `inventario:reclasificar` (ADMINISTRADOR + ENCARGADO_DEPOSITO). El input
 * viaja completo (variante, depósito, cantidad, resultado, motivo?, rma_id?)
 * y se valida con `ReclasificarDevueltoSchema` (superRefine NO_APTO→motivo).
 */
export async function reclasificarUnidadDevuelta(
  input: unknown,
): Promise<ActionResult<ReclasificarDevueltoResultado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const autorizado = await usuarioTienePermiso(session.userId, "inventario:reclasificar");
  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso requerido para reclasificar unidades devueltas.",
      },
    };
  }

  const parsed = ReclasificarDevueltoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Los datos enviados no son válidos.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }

  try {
    const resultado = await reclasificarDevuelto(parsed.data, session.userId);
    revalidatePath("/inventario/devoluciones");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }
    console.error("[reclasificarUnidadDevuelta action] Error inesperado:", err);
    return { success: false, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };
  }
}

/**
 * Aprueba una `ReclasificacionSolicitud` pendiente. Mismo gate que la ruta
 * `PATCH /api/inventario/reclasificaciones/[id]/aprobar`:
 * `inventario:reclasificar_aprobar` (solo ADMINISTRADOR).
 */
export async function aprobarSolicitudAction(
  solicitudId: string,
): Promise<ActionResult<SolicitudAprobadaResultado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const autorizado = await usuarioTienePermiso(session.userId, "inventario:reclasificar_aprobar");
  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso requerido para aprobar solicitudes de reclasificación.",
      },
    };
  }

  try {
    const resultado = await aprobarSolicitud(solicitudId, session.userId);
    revalidatePath("/inventario/devoluciones");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }
    console.error("[aprobarSolicitudAction] Error inesperado:", err);
    return { success: false, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };
  }
}

/**
 * Rechaza una `ReclasificacionSolicitud` pendiente con motivo obligatorio.
 * Mismo gate que la ruta `PATCH /api/inventario/reclasificaciones/[id]/rechazar`:
 * `inventario:reclasificar_aprobar` (solo ADMINISTRADOR).
 */
export async function rechazarSolicitudAction(
  solicitudId: string,
  rechazadaMotivo: string,
): Promise<ActionResult<SolicitudRechazadaResultado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const autorizado = await usuarioTienePermiso(session.userId, "inventario:reclasificar_aprobar");
  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso requerido para rechazar solicitudes de reclasificación.",
      },
    };
  }

  const parsed = RechazarSolicitudSchema.safeParse({ rechazada_motivo: rechazadaMotivo });
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "El motivo de rechazo es obligatorio.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }

  try {
    const resultado = await rechazarSolicitud(solicitudId, session.userId, parsed.data.rechazada_motivo);
    revalidatePath("/inventario/devoluciones");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }
    console.error("[rechazarSolicitudAction] Error inesperado:", err);
    return { success: false, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };
  }
}