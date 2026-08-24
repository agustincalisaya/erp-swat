"use server";

/**
 * @module actions — inventario/auditoria
 * @description Server Actions para la HU-A7 (Auditoría Forense de Inventario).
 *
 * Estas actions se invocan EXCLUSIVAMENTE desde Client Components tras un
 * evento de usuario (ej: click en "Verificar Cadena" o "Revelar dato").
 * La lectura inicial de la tabla usa RSC en `page.tsx` — acá solo viven
 * interacciones post-render que requieren retroalimentación dinámica.
 *
 * Restricción Crítica de Seguridad (HU-A7 Criterio 4):
 *  `revelarDatoSensibleAction` es una operación indisoluble en el backend:
 *  descifra AES-256-GCM e inmediatamente inserta el evento LECTURA_SENSIBLE
 *  en el AuditLog dentro de la misma llamada de servidor. El cliente no puede
 *  obtener el dato sin el audit trail correspondiente.
 */

import { headers } from "next/headers";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  verificarCadenaHashesInventario,
  registrarAccesoDatoSensible,
  type ResultadoVerificacionInventario,
  type DatoSensibleRevelado,
} from "@/lib/services/inventario/auditoria.service";
import {
  RevelarDatoSensibleSchema,
} from "@/lib/schemas/inventario-auditoria.schema";

const PERMISO_LEER_FORENSE = "auditoria:leer_forense";
const PERMISO_VERIFICAR_CADENA = "auditoria:verificar_cadena";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno
// ──────────────────────────────────────────────────────────────────────────────

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: verificarIntegridadAction
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recalcula la cadena SHA-256 de los eventos de inventario y devuelve
 * el resultado de la verificación. Requiere permiso `auditoria:verificar_cadena`.
 */
export async function verificarIntegridadAction(): Promise<
  ActionResult<ResultadoVerificacionInventario>
> {
  const sesion = await getServerSession();
  if (!sesion) {
    return { success: false, error: { code: "UNAUTHORIZED", message: "Sesión requerida." } };
  }

  const autorizado = await usuarioTienePermiso(sesion.userId, PERMISO_VERIFICAR_CADENA);
  if (!autorizado) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "No tenés el permiso para verificar la cadena de integridad." },
    };
  }

  try {
    const resultado = await verificarCadenaHashesInventario();
    return { success: true, data: resultado };
  } catch (err) {
    console.error("[HU-A7][verificarIntegridadAction] Error:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error al verificar la cadena de integridad." },
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: revelarDatoSensibleAction
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Descifra un campo sensible de un LegajoPrueba Y registra el acceso en el
 * AuditLog como `LECTURA_SENSIBLE` en un flujo indisoluble de backend.
 * Requiere permiso `auditoria:leer_forense`.
 *
 * El dato descifrado NUNCA se persiste. Solo vive en memoria durante
 * la duración de esta Server Action y se retorna al cliente como string.
 */
export async function revelarDatoSensibleAction(
  payload: unknown,
): Promise<ActionResult<DatoSensibleRevelado>> {
  // 1. Sesión y permiso
  const sesion = await getServerSession();
  if (!sesion) {
    return { success: false, error: { code: "UNAUTHORIZED", message: "Sesión requerida." } };
  }

  const autorizado = await usuarioTienePermiso(sesion.userId, PERMISO_LEER_FORENSE);
  if (!autorizado) {
    return {
      success: false,
      error: { code: "FORBIDDEN", message: "No tenés el permiso para acceder a datos sensibles." },
    };
  }

  // 2. Validación de entrada con Zod
  const parsed = RevelarDatoSensibleSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.errors[0]?.message ?? "Datos de entrada inválidos.",
      },
    };
  }

  // 3. Extraer IP del header para el AuditLog
  const headersList = await headers();
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown";

  // 4. Operación indisoluble: descifrado + inserción del AuditLog
  try {
    const resultado = await registrarAccesoDatoSensible(
      parsed.data.legajo_prueba_id,
      parsed.data.campo,
      sesion.userId,
      ip,
    );
    return { success: true, data: resultado };
  } catch (err) {
    console.error("[HU-A7][revelarDatoSensibleAction] Error:", err);
    return {
      success: false,
      error: {
        code: "DECRYPT_ERROR",
        message: "No se pudo descifrar el dato. Verificá la clave de cifrado.",
      },
    };
  }
}
