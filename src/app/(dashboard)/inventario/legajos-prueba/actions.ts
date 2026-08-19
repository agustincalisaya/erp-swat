"use server";

/**
 * @module actions — legajos-prueba
 * @description Server Actions para el módulo de Legajos de Prueba (HU-A3).
 *
 * Las Server Actions se invocan directamente desde Client Components
 * (ej: `LegajoPruebaForm.tsx`) sin pasar por un fetch manual.
 * Zod re-valida aquí porque los datos cruzan la frontera cliente→servidor.
 *
 * Importante: aunque el origen de la llamada es el cliente, esta función
 * corre EXCLUSIVAMENTE en el servidor de Next.js. El cifrado AES-256 y el
 * acceso a la BD ocurren aquí, nunca en el navegador.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { IniciarLegajoPruebaSchema } from "@/lib/schemas/inventario.schema";
import { asignarStockEnPrueba } from "@/lib/services/inventario/legajo-prueba.service";
import { getServerSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de retorno de Server Actions
// ──────────────────────────────────────────────────────────────────────────────

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

export interface LegajoPruebaActionData {
  legajo_prueba_id: string;
  movimiento_stock_id: string;
  variante_sku_id: string;
  deposito_origen_id: string;
  cantidad: number;
  fecha_inicio_prueba: Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Action: iniciarLegajoPruebaAction
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Server Action equivalente al `POST /api/inventario/legajos-prueba`.
 * Invocada desde `LegajoPruebaForm` sin fetch explícito.
 *
 * Flujo:
 *  1. Verificar sesión activa → UNAUTHORIZED si no hay sesión.
 *  2. Re-validar datos con Zod (defensa en profundidad).
 *  3. Extraer IP de los headers del servidor.
 *  4. Delegar a `asignarStockEnPrueba` (transacción atómica + cifrado).
 *  5. Invalidar caché de la ruta para refrescar la tabla.
 *
 * @param formData - Datos del formulario tipados como `unknown` (vienen del cliente).
 * @returns ActionResult con los datos del legajo creado o descripción del error.
 */
export async function iniciarLegajoPruebaAction(
  formData: unknown,
): Promise<ActionResult<LegajoPruebaActionData>> {
  // 1. Verificar sesión formal (helper de autenticación — HU-D)
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Sesión requerida para realizar esta operación.",
      },
    };
  }

  // 2. Re-validar con Zod (los datos del cliente SIEMPRE se re-validan en servidor)
  const parsed = IniciarLegajoPruebaSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      },
    };
  }

  // 3. Extraer IP del cliente (para AuditLog)
  const headersList = await headers();
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown";

  // 4. Ejecutar operación atómica
  try {
    const resultado = await asignarStockEnPrueba(
      parsed.data,
      session.userId,
      ip,
    );

    // 5. Invalidar caché para refrescar la tabla de la página
    revalidatePath("/inventario/legajos-prueba");

    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return {
        success: false,
        error: { code: err.code, message: err.message },
      };
    }

    console.error("[iniciarLegajoPruebaAction] Error inesperado:", err);
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Error interno. Intentá nuevamente.",
      },
    };
  }
}
