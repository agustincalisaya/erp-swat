"use server";

/**
 * @module actions — tesorería / cuentas propias (HU-G5)
 * @description Server Actions de la consola de cuentas propias: alta, edición,
 * baja lógica y revelado explícito de datos bancarios.
 *
 * Wrappers finos (spec §1, mismo patrón que
 * `tesoreria/cuentas-por-pagar/actions.ts`): resuelven sesión + permiso GRANULAR,
 * parsean con Zod e invocan la MISMA función de servicio que usan las rutas
 * `/api/tesoreria/cuentas-propias/**`. Ninguna regla de negocio vive acá.
 */

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  CrearCuentaPropiaSchema,
  CuentaPropiaIdSchema,
  DarDeBajaCuentaPropiaSchema,
  EditarCuentaPropiaSchema,
} from "@/lib/schemas/cuenta-propia.schema";
import {
  crearCuentaPropia,
  darDeBajaCuentaPropia,
  editarCuentaPropia,
  PERMISO_GESTIONAR_CUENTAS_BANCARIAS,
  PERMISO_VER_DATOS_BANCARIOS,
  revelarDatosBancarios,
  type CuentaPropiaCreada,
  type CuentaPropiaDadaDeBaja,
  type CuentaPropiaEditada,
  type CuentaPropiaRevelada,
} from "@/lib/services/tesoreria/cuenta-propia.service";

/**
 * `ActionResult` local de este módulo. Mismo shape plano que el resto del
 * proyecto (`{ data, error }`), EXTENDIDO con `details?: unknown` en la variante
 * de error para propagar los `fieldErrors` de Zod al formulario sin perder el
 * contrato `{ code, message }`.
 */
export type ActionResult<T> =
  | { data: T; error: null }
  | {
      data: null;
      error: { code: string; message: string; details?: unknown };
    };

function fallo(
  code: string,
  message: string,
  details?: unknown,
): { data: null; error: { code: string; message: string; details?: unknown } } {
  return {
    data: null,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
}

/** Alta de una cuenta propia (`tesoreria:gestionar_cuentas_bancarias`). */
export async function registrarCuentaPropiaAction(
  input: unknown,
): Promise<ActionResult<CuentaPropiaCreada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsed = CrearCuentaPropiaSchema.safeParse(input);
  if (!parsed.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Datos inválidos",
      parsed.error.flatten().fieldErrors,
    );
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CUENTAS_BANCARIAS))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_GESTIONAR_CUENTAS_BANCARIAS}"`);
  }

  try {
    const creada = await crearCuentaPropia(parsed.data, session.userId);
    return { data: creada, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[registrarCuentaPropiaAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Edición parcial de una cuenta propia (`tesoreria:gestionar_cuentas_bancarias`). */
export async function editarCuentaPropiaAction(
  id: string,
  input: unknown,
): Promise<ActionResult<CuentaPropiaEditada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = CuentaPropiaIdSchema.safeParse(id);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = EditarCuentaPropiaSchema.safeParse(input);
  if (!parsed.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Datos inválidos",
      parsed.error.flatten().fieldErrors,
    );
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CUENTAS_BANCARIAS))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_GESTIONAR_CUENTAS_BANCARIAS}"`);
  }

  try {
    const editada = await editarCuentaPropia(parsedId.data, parsed.data, session.userId);
    return { data: editada, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[editarCuentaPropiaAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Baja lógica de una cuenta propia (`tesoreria:gestionar_cuentas_bancarias`). */
export async function darDeBajaCuentaPropiaAction(
  id: string,
  input: unknown,
): Promise<ActionResult<CuentaPropiaDadaDeBaja>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = CuentaPropiaIdSchema.safeParse(id);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  const parsed = DarDeBajaCuentaPropiaSchema.safeParse(input);
  if (!parsed.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Datos inválidos",
      parsed.error.flatten().fieldErrors,
    );
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CUENTAS_BANCARIAS))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_GESTIONAR_CUENTAS_BANCARIAS}"`);
  }

  try {
    const dada = await darDeBajaCuentaPropia(parsedId.data, parsed.data, session.userId);
    return { data: dada, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[darDeBajaCuentaPropiaAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}

/** Revelado explícito de CBU/alias (`tesoreria:ver_datos_bancarios`). */
export async function revelarDatosBancariosAction(
  id: string,
): Promise<ActionResult<CuentaPropiaRevelada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsedId = CuentaPropiaIdSchema.safeParse(id);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "ID inválido");
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_VER_DATOS_BANCARIOS))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VER_DATOS_BANCARIOS}"`);
  }

  try {
    const revelado = await revelarDatosBancarios(parsedId.data, session.userId);
    return { data: revelado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[revelarDatosBancariosAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
