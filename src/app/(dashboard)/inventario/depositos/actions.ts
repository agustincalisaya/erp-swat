"use server";

import { ServiceError } from "@/lib/errors/service-error";
import { ActualizarUmbralesStockSchema } from "@/lib/schemas/inventario.schema";
import { actualizarUmbrales as actualizarUmbralesService } from "@/lib/services/inventario/stock.service";
import { getServerSession } from "@/lib/auth/session";

type ActualizarUmbralesResult =
  | {
      data: { stock_deposito_id: string; punto_pedido: number; stock_seguridad: number };
      error: null;
    }
  | { data: null; error: { code: string; message: string } };

/**
 * Server Action equivalente a `PATCH /api/inventario/stock/umbrales`
 * (`app/api/inventario/stock/umbrales/route.ts`) — mismo camino: ambas
 * superficies resuelven `usuarioId` desde la sesión real
 * (`getServerSession()`, Módulo D) en vez de confiar en un valor recibido
 * del cliente. Reemplaza el mock `USUARIO_ID_MOCK` que usaba esta Action
 * antes de que `lib/auth/session.ts` existiera.
 */
export async function actualizarUmbrales(formData: FormData): Promise<ActualizarUmbralesResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

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
    const actualizado = await actualizarUmbralesService(parsed.data, session.userId);
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
