"use server";

import { ServiceError } from "@/lib/errors/service-error";
import { ActualizarUmbralesStockSchema } from "@/lib/schemas/inventario.schema";
import { actualizarUmbrales as actualizarUmbralesService } from "@/lib/services/inventario/stock.service";

type ActualizarUmbralesResult =
  | {
      data: { stock_deposito_id: string; punto_pedido: number; stock_seguridad: number };
      error: null;
    }
  | { data: null; error: { code: string; message: string } };

/**
 * Server Action equivalente a `PATCH /api/inventario/stock/umbrales` (5.1).
 *
 * `usuarioId` se recibe como primer argumento (bind desde el caller ya
 * autenticado, ej. `actualizarUmbrales.bind(null, usuarioId)` en el
 * Server Component que renderiza el formulario) en lugar de leerse de
 * `formData`: el identificador de usuario nunca debe confiar en datos
 * enviados por el cliente. `lib/auth/session.ts` (Módulo D) todavía no
 * existe — cuando esté disponible, esta Action debe resolver `usuarioId`
 * a partir de la sesión en vez de recibirlo por parámetro.
 */
export async function actualizarUmbrales(
  usuarioId: string,
  formData: FormData,
): Promise<ActualizarUmbralesResult> {
  const parsed = ActualizarUmbralesStockSchema.safeParse({
    variante_sku_id: formData.get("variante_sku_id"),
    deposito_id: formData.get("deposito_id"),
    punto_pedido: Number(formData.get("punto_pedido")),
    stock_seguridad: Number(formData.get("stock_seguridad")),
  });

  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Datos inválidos",
      },
    };
  }

  try {
    const actualizado = await actualizarUmbralesService(parsed.data, usuarioId);
    return {
      data: {
        stock_deposito_id: actualizado.id,
        punto_pedido: actualizado.punto_pedido,
        stock_seguridad: actualizado.stock_seguridad,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { data: null, error: { code: err.code, message: err.message } };
    }
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error inesperado" } };
  }
}
