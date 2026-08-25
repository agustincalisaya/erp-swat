"use server";

/**
 * @module actions — inventario/auditoria
 * @description Server Actions para la HU-A7 (Auditoría Forense de Inventario).
 *
 * Solo lectura — ninguna action expone mutaciones sobre el AuditLog.
 * La lectura inicial usa RSC en `page.tsx`; esta acción solo cubre la
 * verificación interactiva de integridad SHA-256.
 */

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import {
  verificarCadenaHashesInventario,
  type ResultadoVerificacionInventario,
} from "@/lib/services/inventario/auditoria.service";

const PERMISO_VERIFICAR_CADENA = "auditoria:verificar_cadena";
const PERMISO_LEER_FORENSE = "auditoria:leer_forense";

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
 * el resultado de la verificación (integra / punto de ruptura).
 * Requiere permiso `auditoria:verificar_cadena` o `auditoria:leer_forense`.
 */
export async function verificarIntegridadAction(): Promise<
  ActionResult<ResultadoVerificacionInventario>
> {
  const sesion = await getServerSession();
  if (!sesion) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida." },
    };
  }

  const autorizado =
    (await usuarioTienePermiso(sesion.userId, PERMISO_VERIFICAR_CADENA)) ||
    (await usuarioTienePermiso(sesion.userId, PERMISO_LEER_FORENSE));

  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso para verificar la cadena de integridad.",
      },
    };
  }

  try {
    const resultado = await verificarCadenaHashesInventario();
    return { success: true, data: resultado };
  } catch (err) {
    console.error("[HU-A7][verificarIntegridadAction] Error:", err);
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Error al verificar la cadena de integridad.",
      },
    };
  }
}
