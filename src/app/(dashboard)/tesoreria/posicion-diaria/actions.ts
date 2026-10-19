"use server";

/**
 * @module actions — tesorería / posición diaria (HU-G7)
 * @description Server Actions de la consola de posición diaria: registro
 * append-only de un saldo diario. Wrapper fino (spec §1, mismo patrón que
 * `tesoreria/cuentas-propias/actions.ts`): resuelve sesión + permiso GRANULAR,
 * parsea con Zod e invoca la MISMA función de servicio que usa la ruta
 * `/api/tesoreria/posicion-diaria`. Ninguna regla de negocio vive acá.
 */

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { RegistrarSaldoDiarioSchema } from "@/lib/schemas/posicion-diaria.schema";
import {
  PERMISO_REGISTRAR_SALDO_DIARIO,
  registrarSaldoDiario,
  type SaldoRegistrado,
} from "@/lib/services/tesoreria/posicion-diaria.service";

/**
 * `ActionResult` local de este módulo. Mismo shape plano que el resto del
 * proyecto (`{ data, error }`), EXTENDIDO con `details?: unknown` para propagar
 * los `fieldErrors` de Zod al formulario sin perder el contrato
 * `{ code, message }`.
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

/**
 * Registro de un saldo diario (`tesoreria:registrar_saldo_diario`). Append-only:
 * una corrección es OTRA llamada del mismo día con el saldo corregido.
 */
export async function registrarSaldoDiarioAction(
  input: unknown,
): Promise<ActionResult<SaldoRegistrado>> {
  const session = await getServerSession();
  if (!session) return fallo("UNAUTHORIZED", "Sesión requerida");

  const parsed = RegistrarSaldoDiarioSchema.safeParse(input);
  if (!parsed.success) {
    return fallo(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Datos inválidos",
      parsed.error.flatten().fieldErrors,
    );
  }

  if (!(await usuarioTienePermiso(session.userId, PERMISO_REGISTRAR_SALDO_DIARIO))) {
    return fallo("FORBIDDEN", `No tenés el permiso "${PERMISO_REGISTRAR_SALDO_DIARIO}"`);
  }

  try {
    const registrado = await registrarSaldoDiario(parsed.data, session.userId);
    return { data: registrado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) return fallo(err.code, err.message, err.details);
    console.error("[registrarSaldoDiarioAction] Error inesperado:", err);
    return fallo("INTERNAL_ERROR", "Error interno. Intentá nuevamente.");
  }
}
