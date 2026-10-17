"use server";

/**
 * @module actions — cuentas-corrientes (HU-B5, spec_modulo_B.md §2.5)
 * @description Server Actions equivalentes a
 * `POST /api/ventas/cuentas-corrientes/[cliente_id]/operaciones` y
 * `PATCH /api/ventas/cuentas-corrientes/operaciones/[id]/resolver`.
 *
 * Wrappers finos (spec §1): sesión + permiso GRANULAR, parseo Zod, misma
 * función de servicio que el Route Handler equivalente y shape plano
 * `{ data, error }`. Sin lógica de negocio acá — vive en
 * `cuenta-corriente.service.ts`. El sufijo `Action` evita el choque de
 * nombres con las funciones homónimas del servicio (patrón de HU-B4).
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import {
  ClienteCuentaCorrienteIdSchema,
  OperacionCuentaCorrienteIdSchema,
  RegistrarOperacionCuentaCorrienteSchema,
  ResolverExcepcionCreditoSchema,
} from "@/lib/schemas/ventas.schema";
import {
  PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO,
  PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE,
  registrarOperacionCuentaCorriente,
  resolverExcepcionCredito,
  type ExcepcionCreditoResuelta,
  type OperacionCuentaCorrienteRegistrada,
} from "@/lib/services/ventas/cuenta-corriente.service";

const CUENTAS_CORRIENTES_PATH = "/ventas/cuentas-corrientes";

export type ActionError = { code: string; message: string; details?: unknown };
export type ActionResult<T> = { data: T; error: null } | { data: null; error: ActionError };

function fallo(code: string, message: string, details?: unknown): { data: null; error: ActionError } {
  return { data: null, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

/**
 * Server Action equivalente a `POST /api/ventas/cuentas-corrientes/[cliente_id]/operaciones`.
 * Si la operación excede el límite queda RETENIDA (ya persistida) y se devuelve
 * `LIMITE_CREDITO_EXCEDIDO` con `error.details.operacion_id`.
 */
export async function registrarOperacionCuentaCorrienteAction(
  clienteId: string,
  input: unknown,
): Promise<ActionResult<OperacionCuentaCorrienteRegistrada>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_GESTIONAR_CUENTA_CORRIENTE}"`);
  }

  const parsedId = ClienteCuentaCorrienteIdSchema.safeParse(clienteId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido");
  }
  const parsed = RegistrarOperacionCuentaCorrienteSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const resultado = await registrarOperacionCuentaCorriente(parsedId.data, parsed.data);
    revalidatePath(`${CUENTAS_CORRIENTES_PATH}/${parsedId.data}`);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) {
      // La operación RETENIDA ya está committeada: refrescar la vista igual.
      if (err.code === "LIMITE_CREDITO_EXCEDIDO") {
        revalidatePath(`${CUENTAS_CORRIENTES_PATH}/${parsedId.data}`);
      }
      return fallo(err.code, err.message, err.details);
    }
    console.error("[registrarOperacionCuentaCorrienteAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}

/** Server Action equivalente a `PATCH /api/ventas/cuentas-corrientes/operaciones/[id]/resolver`. */
export async function resolverExcepcionCreditoAction(
  operacionId: string,
  input: unknown,
): Promise<ActionResult<ExcepcionCreditoResuelta>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_AUTORIZAR_EXCEPCION_CREDITO}"`);
  }

  const parsedId = OperacionCuentaCorrienteIdSchema.safeParse(operacionId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido");
  }
  const parsed = ResolverExcepcionCreditoSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const resultado = await resolverExcepcionCredito(parsedId.data, parsed.data, session.userId);
    revalidatePath(CUENTAS_CORRIENTES_PATH, "layout");
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[resolverExcepcionCreditoAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}
