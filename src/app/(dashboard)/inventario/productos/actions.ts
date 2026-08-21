"use server";

/**
 * @module actions — productos (HU-A1)
 * @description Server Actions equivalentes a los Route Handlers REST de
 * `app/api/inventario/productos/` — alta de Producto Maestro y generación en
 * lote de Variantes SKU (task_relos.md sección 6). Se invocan directamente
 * desde Client Components sin pasar por un fetch manual.
 *
 * A diferencia de los Route Handlers (que devuelven `NextResponse`), las
 * Server Actions retornan un objeto plano `{ data, error }` — mismo shape
 * que `app/(dashboard)/inventario/depositos/actions.ts`.
 */
import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";
import {
  CrearProductoMaestroSchema,
  GenerarVariantesMatrizSchema,
} from "@/lib/schemas/inventario.schema";
import {
  crearProductoMaestro as crearProductoMaestroService,
  generarVariantesMatriz as generarVariantesMatrizService,
  type ResultadoGenerarVariantesMatriz,
} from "@/lib/services/inventario/producto.service";
import type { ProductoMaestro } from "@prisma/client";

type ActionError = { code: string; message: string; fieldErrors?: Record<string, string[]> };

type CrearProductoMaestroResult =
  | { data: ProductoMaestro; error: null }
  | { data: null; error: ActionError };

type GenerarVariantesMatrizResult =
  | { data: ResultadoGenerarVariantesMatriz; error: null }
  | { data: null; error: ActionError };

/** Server Action equivalente a `POST /api/inventario/productos`. */
export async function crearProductoMaestro(formData: unknown): Promise<CrearProductoMaestroResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const parsed = CrearProductoMaestroSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  try {
    const producto = await crearProductoMaestroService(parsed.data, session.userId);
    revalidatePath("/inventario/productos");
    return { data: producto, error: null };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { data: null, error: { code: err.code, message: err.message } };
    }

    console.error("[crearProductoMaestro action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

/**
 * Server Action equivalente a `POST /api/inventario/productos/[id]/variantes/generar`.
 * `productoMaestroId` se pasa explícito (no viaja dentro de `formData`) —
 * mismo criterio que la ruta REST: el recurso sobre el que se opera lo fija
 * el llamador, no el payload.
 */
export async function generarVariantesMatriz(
  productoMaestroId: string,
  formData: unknown,
): Promise<GenerarVariantesMatrizResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  const parsed = GenerarVariantesMatrizSchema.safeParse({
    ...(typeof formData === "object" && formData !== null ? formData : {}),
    producto_maestro_id: productoMaestroId,
  });

  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  try {
    const resultado = await generarVariantesMatrizService(parsed.data, session.userId);
    revalidatePath("/inventario/productos");
    return { data: resultado, error: null };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { data: null, error: { code: err.code, message: err.message } };
    }

    console.error("[generarVariantesMatriz action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}
