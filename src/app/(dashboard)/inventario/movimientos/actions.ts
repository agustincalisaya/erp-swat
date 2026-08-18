"use server";

/**
 * @module actions — movimientos (HU-2)
 * @description Server Actions para el flujo de escaneo/ingreso de mercadería.
 * Se invocan directamente desde `IngresoEscaneoPanel.tsx` sin fetch manual.
 */
import { revalidatePath } from "next/cache";
import {
  ResolverCodigoEscaneoSchema,
  RegistrarIngresoPorEscaneoSchema,
} from "@/lib/schemas/inventario.schema";
import {
  resolverCodigoEscaneo,
  registrarIngresoStock,
  type CodigoResuelto,
  type IngresoRegistrado,
} from "@/lib/services/inventario/movimiento.service";
import { getServerSession } from "@/lib/auth/session";
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

/** Server Action equivalente a `POST /api/inventario/escaner/resolver`. */
export async function resolverCodigoEscaneoAction(
  codigo: string,
): Promise<ActionResult<CodigoResuelto>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const parsed = ResolverCodigoEscaneoSchema.safeParse({ codigo });
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Código inválido",
      },
    };
  }

  try {
    const resultado = await resolverCodigoEscaneo(parsed.data);

    if (!resultado) {
      return {
        success: false,
        error: { code: "VARIANTE_NO_ENCONTRADA", message: "Código no registrado en catálogo activo." },
      };
    }

    return { success: true, data: resultado };
  } catch (err) {
    console.error("[resolverCodigoEscaneoAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

/** Registra el ingreso de stock confirmado a partir de un código resuelto. */
export async function registrarIngresoStockAction(
  formData: unknown,
): Promise<ActionResult<IngresoRegistrado>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const parsed = RegistrarIngresoPorEscaneoSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Datos inválidos",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }

  try {
    const resultado = await registrarIngresoStock(parsed.data, session.userId);
    revalidatePath("/inventario/movimientos");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[registrarIngresoStockAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}
