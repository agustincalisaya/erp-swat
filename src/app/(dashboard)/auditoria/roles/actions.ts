"use server";

/**
 * @module actions — roles (Módulo D.2)
 * @description Server Actions para los Endpoints 2.2.5 (alta de Rol) y
 * 2.2.6 (actualización de permisos de un Rol). Mismo patrón que
 * `usuarios/actions.ts`: Zod re-valida en el borde servidor aunque el
 * origen sea un Client Component.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { CrearRolSchema, ActualizarPermisosRolSchema } from "@/lib/schemas/auditoria.schema";
import { crearRol, actualizarPermisosRol } from "@/lib/services/auditoria/rol.service";
import type { RolCreado, RolPermisosActualizados } from "@/lib/services/auditoria/rol.service";
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
// Action: crearRolAction (Endpoint 2.2.5)
// ──────────────────────────────────────────────────────────────────────────────

export async function crearRolAction(formData: unknown): Promise<ActionResult<RolCreado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  // Camino A (task_cali_roles_permisos.md, ronda de corrección posterior al
  // cierre de la tarea de Roles/Permisos) — este Server Action llama a
  // crearRol() directo, sin pasar por POST /api/auth/roles (que sí queda
  // gateado con withPermission). Sin este chequeo acá, la UI seguía siendo
  // un camino sin gate para el mismo problema — mismo fix ya aplicado en
  // usuarios/actions.ts.
  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_ROLES_ADMINISTRAR);
  if (!autorizado) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta operación." },
    };
  }

  const parsed = CrearRolSchema.safeParse(formData);
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
    const resultado = await crearRol(parsed.data, session.userId, ip);
    revalidatePath("/auditoria/roles");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[crearRolAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: actualizarPermisosRolAction (Endpoint 2.2.6)
// ──────────────────────────────────────────────────────────────────────────────

export async function actualizarPermisosRolAction(
  formData: unknown,
): Promise<ActionResult<RolPermisosActualizados>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  // Camino A — ver nota idéntica en crearRolAction() arriba: este Server
  // Action llama a actualizarPermisosRol() directo, sin pasar por
  // PATCH /api/auth/roles/[id]/permisos (que sí queda gateado con
  // withPermission). Mismo fix ya aplicado en usuarios/actions.ts.
  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_ROLES_ADMINISTRAR);
  if (!autorizado) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "No tenés el permiso requerido para realizar esta operación." },
    };
  }

  const parsed = ActualizarPermisosRolSchema.safeParse(formData);
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
    const resultado = await actualizarPermisosRol(parsed.data, session.userId, ip);
    revalidatePath("/auditoria/roles");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[actualizarPermisosRolAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}
