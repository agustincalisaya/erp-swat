"use server";

import { ServiceError } from "@/lib/errors/service-error";
import { ActualizarUmbralesStockSchema } from "@/lib/schemas/inventario.schema";
import {
  actualizarUmbrales as actualizarUmbralesService,
  obtenerStockDepositoPorCombinacion as obtenerStockDepositoPorCombinacionService,
  type StockDepositoCombinacion,
} from "@/lib/services/inventario/stock.service";
import {
  listarProductosConVariantes as listarProductosConVariantesService,
  type ProductoConVariantesResumen,
} from "@/lib/services/inventario/producto.service";
import {
  listarVariantesPorProducto as listarVariantesPorProductoService,
  type VariantePorProducto,
} from "@/lib/services/inventario/variante.service";
import {
  listarDepositosActivos as listarDepositosActivosService,
  type DepositoActivo,
} from "@/lib/services/inventario/deposito.service";
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

// ──────────────────────────────────────────────────────────────────────────────
// Selector jerárquico de umbrales (task_cali_selector_umbrales.md)
// ──────────────────────────────────────────────────────────────────────────────

type ActionError = { code: string; message: string };

type ListarDepositosActivosResult =
  | { data: DepositoActivo[]; error: null }
  | { data: null; error: ActionError };

/** Server Action — 1er nivel del selector jerárquico. */
export async function listarDepositosActivos(): Promise<ListarDepositosActivosResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const depositos = await listarDepositosActivosService();
    return { data: depositos, error: null };
  } catch (err) {
    console.error("[listarDepositosActivos action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

type ListarProductosConVariantesResult =
  | { data: ProductoConVariantesResumen[]; error: null }
  | { data: null; error: ActionError };

/** Server Action — 2do nivel del selector jerárquico, habilitado tras elegir Depósito. */
export async function listarProductosConVariantes(): Promise<ListarProductosConVariantesResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const productos = await listarProductosConVariantesService();
    return { data: productos, error: null };
  } catch (err) {
    console.error("[listarProductosConVariantes action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

type ListarVariantesPorProductoResult =
  | { data: VariantePorProducto[]; error: null }
  | { data: null; error: ActionError };

/** Server Action — 3er nivel del selector jerárquico, habilitado tras elegir Producto. */
export async function listarVariantesPorProducto(
  productoMaestroId: string,
): Promise<ListarVariantesPorProductoResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const variantes = await listarVariantesPorProductoService(productoMaestroId);
    return { data: variantes, error: null };
  } catch (err) {
    console.error("[listarVariantesPorProducto action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}

type ObtenerStockDepositoResult =
  | { data: { stockDeposito: StockDepositoCombinacion | null }; error: null }
  | { data: null; error: ActionError };

/**
 * Server Action — al completar los 3 niveles del selector, resuelve si la
 * combinación ya tiene fila en `StockDeposito` para precargar el formulario
 * o mostrar el indicador "sin stock cargado todavía"
 * (task_cali_selector_umbrales.md, sección 4). `stockDeposito: null` es un
 * resultado válido, no un error — se envuelve en `data` para distinguirlo
 * del caso de error real.
 */
export async function obtenerStockDepositoPorCombinacion(
  varianteSkuId: string,
  depositoId: string,
): Promise<ObtenerStockDepositoResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Sesión requerida para realizar esta operación." },
    };
  }

  try {
    const stockDeposito = await obtenerStockDepositoPorCombinacionService(varianteSkuId, depositoId);
    return { data: { stockDeposito }, error: null };
  } catch (err) {
    console.error("[obtenerStockDepositoPorCombinacion action] Error inesperado:", err);
    return { data: null, error: { code: "INTERNAL_ERROR", message: "Error interno. Intentá nuevamente." } };
  }
}
