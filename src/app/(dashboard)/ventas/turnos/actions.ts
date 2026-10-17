"use server";

/**
 * @module actions — turno de caja (HU-B2, task_relos.md §5)
 * @description Server Actions equivalentes a `POST /api/ventas/turnos` y
 * `PATCH /api/ventas/turnos/[id]/cerrar`, para el formulario de turno de
 * caja operado por Cajero POS.
 *
 * Wrappers finos (spec §1): resuelven sesión + permiso GRANULAR, parsean con
 * Zod, invocan la MISMA función de servicio que el Route Handler y devuelven
 * el shape plano `{ data, error }`. Está prohibido reimplementar lógica de
 * negocio acá — toda regla vive en `turno-caja.service.ts`.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { AbrirTurnoCajaSchema, CerrarTurnoCajaSchema, TurnoCajaIdSchema } from "@/lib/schemas/ventas.schema";
import {
  abrirTurnoCaja,
  cerrarTurnoCaja,
  PERMISO_VENTAS_GESTIONAR_TURNO_CAJA,
  type TurnoCajaAbierto,
  type TurnoCajaCerrado,
} from "@/lib/services/ventas/turno-caja.service";

const TURNOS_PATH = "/ventas/turnos";

export type ActionResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

function fallo(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}

/** Server Action equivalente a `POST /api/ventas/turnos` (task §5). */
export async function abrirTurnoCajaAction(input: unknown): Promise<ActionResult<TurnoCajaAbierto>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_GESTIONAR_TURNO_CAJA))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_GESTIONAR_TURNO_CAJA}"`);
  }

  const parsed = AbrirTurnoCajaSchema.safeParse(input);
  if (!parsed.success) {
    return fallo("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    const resultado = await abrirTurnoCaja(session.userId, parsed.data);
    revalidatePath(TURNOS_PATH);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[abrirTurnoCajaAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}

/** Server Action equivalente a `PATCH /api/ventas/turnos/[id]/cerrar` (task §5). */
export async function cerrarTurnoCajaAction(
  turnoCajaId: string,
  input: unknown,
): Promise<ActionResult<TurnoCajaCerrado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_VENTAS_GESTIONAR_TURNO_CAJA))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_VENTAS_GESTIONAR_TURNO_CAJA}"`);
  }

  const parsedId = TurnoCajaIdSchema.safeParse(turnoCajaId);
  if (!parsedId.success) {
    return fallo("VALIDATION_ERROR", parsedId.error.issues[0]?.message ?? "Identificador inválido");
  }
  const parsedBody = CerrarTurnoCajaSchema.safeParse(input);
  if (!parsedBody.success) {
    return fallo("VALIDATION_ERROR", parsedBody.error.issues[0]?.message ?? "Datos inválidos");
  }

  try {
    // Deliberadamente SIN `revalidatePath()` acá (a diferencia de
    // `abrirTurnoCajaAction`): Next.js dispara un refresh automático del
    // árbol de Server Components apenas una Server Action invocada vía
    // `useTransition` revalida una ruta, remontando `FormularioTurnoCaja`
    // con `turnoAbierto: null` ANTES de que el Cajero llegue a ver el
    // resultado del arqueo — rompiendo la garantía de "revelar recién
    // después de enviar" (task §8). El propio componente (`FormularioTurnoCaja.tsx`)
    // llama `router.refresh()` explícitamente cuando el Cajero hace clic en
    // "Continuar" del panel de resultado — ese es el único punto donde la
    // pantalla debe refrescar tras un cierre exitoso.
    const resultado = await cerrarTurnoCaja(parsedId.data, session.userId, parsedBody.data);
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message);
    console.error("[cerrarTurnoCajaAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno del servidor");
  }
}
