"use server";

/**
 * @module actions — presupuestos (HU-B3, spec_modulo_B.md §2.3)
 * @description Server Actions equivalentes a `POST /api/ventas/presupuestos`
 * y `PATCH /api/ventas/presupuestos/[id]/aceptar`, para los formularios de
 * Presupuesto operados por Cajero POS.
 *
 * Wrappers finos (spec §1): resuelven sesión + permiso GRANULAR, parsean con
 * Zod, invocan la MISMA función de servicio que el Route Handler y devuelven
 * el shape plano `{ data, error }` (mismo shape que el Route Handler
 * equivalente). Está prohibido reimplementar lógica de negocio acá — toda
 * regla vive en `presupuesto.service.ts`.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { CrearPresupuestoSchema, PresupuestoIdSchema } from "@/lib/schemas/ventas.schema";
import {
  crearPresupuesto,
  aceptarPresupuesto,
  PERMISO_VENTAS_EMITIR_COTIZACION,
  type PresupuestoCreado,
  type PresupuestoAceptado,
} from "@/lib/services/ventas/presupuesto.service";

const PRESUPUESTOS_PATH = "/ventas/presupuestos";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

/** Server Action equivalente a `POST /api/ventas/presupuestos` (spec §2.3). */
export async function crearPresupuestoAction(
  input: unknown,
): Promise<ActionResult<PresupuestoCreado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_EMITIR_COTIZACION))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_EMITIR_COTIZACION}"`);
  }

  const parsed = CrearPresupuestoSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const resultado = await crearPresupuesto(parsed.data, session.userId);
    revalidatePath(PRESUPUESTOS_PATH);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[crearPresupuestoAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}

/** Server Action equivalente a `PATCH /api/ventas/presupuestos/[id]/aceptar` (spec §2.3). */
export async function aceptarPresupuestoAction(
  presupuestoId: string,
): Promise<ActionResult<PresupuestoAceptado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_EMITIR_COTIZACION))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_EMITIR_COTIZACION}"`);
  }

  const parsedId = PresupuestoIdSchema.safeParse(presupuestoId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido");
  }

  try {
    const resultado = await aceptarPresupuesto(parsedId.data, session.userId);
    revalidatePath(PRESUPUESTOS_PATH);
    revalidatePath(`${PRESUPUESTOS_PATH}/${parsedId.data}`);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[aceptarPresupuestoAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}
