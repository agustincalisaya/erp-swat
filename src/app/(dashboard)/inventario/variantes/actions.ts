"use server";

/**
 * @module actions — variantes (HU-A6)
 * @description Server Action de la baja lógica de `VarianteSKU` con motivo de
 * justificación. Zod re-valida en el borde servidor aunque el origen sea un
 * Client Component (`ModalJustificacionBaja`), y el service re-valida el
 * stock (defensa en profundidad, R3).
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getServerSession } from "@/lib/auth/session";
import {
  BajaLogicaVarianteSchema,
  EditarVarianteOperativaSchema,
  type EditarVarianteOperativaInput,
} from "@/lib/schemas/inventario.schema";
import {
  darDeBajaVariante,
  usuarioPuedeBajarVariante,
  editarVarianteOperativa,
  usuarioPuedeEditarVariante,
  buscarVariantesActivas,
  obtenerVarianteParaEdicion,
  type VarianteDadaDeBaja,
  type VarianteActivaResumen,
  type VarianteParaEdicion,
} from "@/lib/services/inventario/variante.service";
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

/** Mismo patrón `resolverIp()` que las actions de auditoría (decisión D1). */
async function resolverIp(): Promise<string> {
  const headersList = await headers();
  return (
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown"
  );
}

export async function darDeBajaVarianteAction(
  formData: unknown,
): Promise<ActionResult<VarianteDadaDeBaja>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  // Mismo gate que la ruta PATCH (decisión D2/D8): sin rol activo autorizado
  // no se llega al service. Sin esto, la UI sería un segundo camino sin
  // protección para la misma operación (Camino A — patrón de auditoría).
  const autorizado = await usuarioPuedeBajarVariante(session.userId);
  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso requerido para realizar esta operación.",
      },
    };
  }

  const input = (formData ?? {}) as { variante_id?: unknown; deletion_reason?: unknown };
  const varianteId = typeof input.variante_id === "string" ? input.variante_id : "";

  if (!varianteId) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador de variante inválido.",
      },
    };
  }

  // El schema es shape-only sobre `deletion_reason`; `variante_id` viaja en
  // el body pero se valida arriba, fuera de Zod (mismo criterio que la ruta).
  const parsed = BajaLogicaVarianteSchema.safeParse({
    deletion_reason: input.deletion_reason,
  });

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
    const resultado = await darDeBajaVariante(
      varianteId,
      session.userId,
      parsed.data.deletion_reason,
      ip,
    );
    revalidatePath("/inventario/variantes");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[darDeBajaVarianteAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

/**
 * HU-A8 — Server Action equivalente a `PATCH /api/inventario/variantes/[id]`.
 * Mismo patrón que `darDeBajaVarianteAction()`: gate de rol activo
 * (`usuarioPuedeEditarVariante()`) antes de tocar el service — sin esto la UI
 * sería un segundo camino sin protección para la misma operación.
 */
export async function editarVarianteOperativaAction(
  id: string,
  input: EditarVarianteOperativaInput,
): Promise<ActionResult<Awaited<ReturnType<typeof editarVarianteOperativa>>>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const autorizado = await usuarioPuedeEditarVariante(session.userId);
  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso requerido para realizar esta operación.",
      },
    };
  }

  const parsed = EditarVarianteOperativaSchema.safeParse(input);

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
    const resultado = await editarVarianteOperativa(id, parsed.data, session.userId, ip);
    revalidatePath("/inventario/variantes");
    return { success: true, data: resultado };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[editarVarianteOperativaAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

/**
 * HU-A8 — búsqueda liviana de solo lectura para poblar un combobox de
 * variantes (análoga a `buscarProductosActivos()` de `productos/actions.ts`).
 * Sin chequeo de rol/permiso a propósito: no muta nada, mismo criterio que
 * su análoga de productos (a diferencia de `editarVarianteOperativaAction()`,
 * que sí lo tiene porque esa sí muta).
 */
export async function buscarVariantesActivasAction(
  query: string,
): Promise<ActionResult<VarianteActivaResumen[]>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const variantes = await buscarVariantesActivas(query);
    return { success: true, data: variantes };
  } catch (err) {
    console.error("[buscarVariantesActivasAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}

/**
 * HU-A8 — trae una `VarianteSKU` activa por id para precargar el formulario
 * de edición. Mismo shape `ActionResult<T>` que el resto de este archivo.
 */
export async function obtenerVarianteParaEdicionAction(
  id: string,
): Promise<ActionResult<VarianteParaEdicion>> {
  const session = await getServerSession();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const variante = await obtenerVarianteParaEdicion(id);
    return { success: true, data: variante };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }

    console.error("[obtenerVarianteParaEdicionAction] Error inesperado:", err);
    return {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." },
    };
  }
}