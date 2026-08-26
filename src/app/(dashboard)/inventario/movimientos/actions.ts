"use server";

/**
 * @module actions — movimientos (HU-2)
 * @description Server Actions para el flujo de escaneo/ingreso de mercadería.
 * Se invocan directamente desde `IngresoEscaneoPanel.tsx` sin fetch manual.
 *
 * Capa 2 de RBAC (Hallazgo 1) — ambas actions verifican, además de la
 * sesión, que el rol activo esté autorizado
 * (`usuarioPuedeRegistrarIngresoStock()`, mismo punto de verdad que
 * `page.tsx` y el Route Handler REST) antes de tocar el service. Sin esto,
 * la Server Action sería un segundo camino sin protección para la misma
 * operación que la página ya bloquea (mismo criterio que
 * `darDeBajaVarianteAction`, HU-A6).
 */
import { revalidatePath } from "next/cache";
import {
  ResolverCodigoEscaneoSchema,
  RegistrarIngresoPorEscaneoSchema,
  CrearTransferenciaSchema,
  TransferenciaIdSchema,
} from "@/lib/schemas/inventario.schema";
import {
  resolverCodigoEscaneo,
  registrarIngresoStock,
  usuarioPuedeRegistrarIngresoStock,
  type CodigoResuelto,
  type IngresoRegistrado,
} from "@/lib/services/inventario/movimiento.service";
import { getServerSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";
import { crearTransferencia, confirmarRecepcionTransferencia } from "@/lib/services/inventario/transferencia.service";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { obtenerStockDisponible } from "@/lib/services/inventario/stock.service";

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

  const autorizado = await usuarioPuedeRegistrarIngresoStock(session.userId);
  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso requerido para realizar esta operación.",
      },
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

  const autorizado = await usuarioPuedeRegistrarIngresoStock(session.userId);
  if (!autorizado) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No tenés el permiso requerido para realizar esta operación.",
      },
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

export async function crearTransferenciaAction(input: unknown): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { success: false, error: { code: "UNAUTHORIZED", message: "Sesión requerida" } };
  if (!(await usuarioTienePermiso(session.userId, "inventario:transferir_stock"))) return { success: false, error: { code: "FORBIDDEN", message: "Permiso requerido" } };
  const parsed = CrearTransferenciaSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Datos inválidos", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> } };
  try {
    const data = await crearTransferencia(parsed.data, session.userId);
    revalidatePath("/inventario/movimientos");
    return { success: true, data };
  } catch (error) {
    if (error instanceof ServiceError) return { success: false, error: { code: error.code, message: error.message } };
    return { success: false, error: { code: "INTERNAL_ERROR", message: "Error interno" } };
  }
}

export async function confirmarRecepcionTransferenciaAction(transferenciaId: string): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { success: false, error: { code: "UNAUTHORIZED", message: "Sesión requerida" } };
  if (!(await usuarioTienePermiso(session.userId, "inventario:confirmar_recepcion"))) return { success: false, error: { code: "FORBIDDEN", message: "Permiso requerido" } };
  const parsedId = TransferenciaIdSchema.safeParse(transferenciaId);
  if (!parsedId.success) return { success: false, error: { code: "VALIDATION_ERROR", message: parsedId.error.issues[0]?.message ?? "ID inválido" } };
  try {
    const data = await confirmarRecepcionTransferencia(parsedId.data, session.userId);
    revalidatePath("/inventario/movimientos");
    revalidatePath("/inventario/movimientos/historial-transferencias");
    return { success: true, data };
  } catch (error) {
    if (error instanceof ServiceError) return { success: false, error: { code: error.code, message: error.message } };
    return { success: false, error: { code: "INTERNAL_ERROR", message: "Error interno" } };
  }
}

export async function obtenerStockDisponibleAction(
  varianteSkuId: string,
  depositoId: string,
): Promise<ActionResult<{ cantidad: number }>> {
  const session = await getServerSession();
  if (!session) return { success: false, error: { code: "UNAUTHORIZED", message: "Sesión requerida" } };
  if (!(await usuarioTienePermiso(session.userId, "inventario:transferir_stock"))) return { success: false, error: { code: "FORBIDDEN", message: "Permiso requerido" } };
  const varianteParsed = TransferenciaIdSchema.safeParse(varianteSkuId);
  const depositoParsed = TransferenciaIdSchema.safeParse(depositoId);
  if (!varianteParsed.success || !depositoParsed.success) return { success: false, error: { code: "VALIDATION_ERROR", message: "SKU o depósito inválido" } };
  const cantidad = await obtenerStockDisponible(varianteParsed.data, depositoParsed.data);
  return { success: true, data: { cantidad } };
}
