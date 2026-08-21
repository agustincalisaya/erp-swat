"use server";

/**
 * @module actions — usuarios (Módulo D.2)
 * @description Server Actions para HU-1 (alta) y HU-2 (baja lógica) de Usuario.
 * Zod re-valida en el borde servidor aunque el origen sea un Client Component.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  CrearUsuarioSchema,
  BajaLogicaUsuarioSchema,
  CambiarEstadoUsuarioSchema,
  ReactivarUsuarioSchema,
} from "@/lib/schemas/auditoria.schema";
import {
  crearUsuario,
  desactivarUsuario,
  cambiarEstadoUsuario,
  reactivarUsuario,
} from "@/lib/services/auditoria/usuario.service";
import type {
  UsuarioCreado,
  UsuarioDadoDeBaja,
  UsuarioEstadoCambiado,
  UsuarioReactivado,
} from "@/lib/services/auditoria/usuario.service";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso, PERMISO_ROLES_ADMINISTRAR } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

async function resolverIp(): Promise<string> {
  const headersList = await headers();
  return (
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown"
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: crearUsuarioAction (HU-1)
// ──────────────────────────────────────────────────────────────────────────────

export async function crearUsuarioAction(formData: unknown): Promise<ActionResult<UsuarioCreado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const parsed = CrearUsuarioSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }

  const ip = await resolverIp();

  try {
    const resultado = await crearUsuario(parsed.data, session.userId, ip);
    revalidatePath("/auditoria/usuarios");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[crearUsuarioAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: desactivarUsuarioAction (HU-2)
// ──────────────────────────────────────────────────────────────────────────────

export async function desactivarUsuarioAction(
  formData: unknown,
): Promise<ActionResult<UsuarioDadoDeBaja>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  // Camino A (task_cali_roles_permisos.md, ronda de corrección posterior al
  // cierre de la tarea de Roles/Permisos) — este Server Action llama a
  // desactivarUsuario() directo, sin pasar por PATCH /api/auth/usuarios/[id]/baja
  // (que sí quedó gateado con withPermission). Sin este chequeo acá, la UI
  // seguía siendo un camino sin gate para el mismo problema.
  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_ROLES_ADMINISTRAR);
  if (!autorizado) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta operación." },
    };
  }

  const parsed = BajaLogicaUsuarioSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "MOTIVO_REQUERIDO",
        message: "El motivo de baja es obligatorio.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }

  const ip = await resolverIp();

  try {
    const resultado = await desactivarUsuario(parsed.data, session.userId, ip);
    revalidatePath("/auditoria/usuarios");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[desactivarUsuarioAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: cambiarEstadoUsuarioAction (Endpoint 2.2.3)
// ──────────────────────────────────────────────────────────────────────────────

export async function cambiarEstadoUsuarioAction(
  formData: unknown,
): Promise<ActionResult<UsuarioEstadoCambiado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  // Camino A — ver nota idéntica en desactivarUsuarioAction() arriba.
  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_ROLES_ADMINISTRAR);
  if (!autorizado) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta operación." },
    };
  }

  const parsed = CambiarEstadoUsuarioSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }

  const ip = await resolverIp();

  try {
    const resultado = await cambiarEstadoUsuario(parsed.data, session.userId, ip);
    revalidatePath("/auditoria/usuarios");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[cambiarEstadoUsuarioAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: reactivarUsuarioAction (task_cali_filtro_reactivacion.md §2)
// ──────────────────────────────────────────────────────────────────────────────

export async function reactivarUsuarioAction(
  formData: unknown,
): Promise<ActionResult<UsuarioReactivado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  // Camino A — ver nota idéntica en desactivarUsuarioAction()/cambiarEstadoUsuarioAction()
  // arriba: este Server Action llama a reactivarUsuario() directo, sin pasar
  // por PATCH /api/auth/usuarios/[id]/reactivar (que sí queda gateado con
  // withPermission). Sin este chequeo acá, la UI sería un segundo camino sin
  // protección para la misma operación — el mismo problema que motivó el
  // Camino A original en desactivarUsuarioAction().
  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_ROLES_ADMINISTRAR);
  if (!autorizado) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta operación." },
    };
  }

  const parsed = ReactivarUsuarioSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "MOTIVO_REQUERIDO",
        message: "El motivo de reactivación es obligatorio.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }

  const ip = await resolverIp();

  try {
    const resultado = await reactivarUsuario(parsed.data, session.userId, ip);
    revalidatePath("/auditoria/usuarios");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[reactivarUsuarioAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}
