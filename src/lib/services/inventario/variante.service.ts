import "server-only";

import { prisma } from "@/lib/db/prisma";

export interface VariantePorProducto {
  id: string;
  talle: string;
  color: string;
  genero: string;
  modelo: string;
  sku: string;
}

/**
 * task_cali_selector_umbrales.md — sección 3: tercer nivel del selector
 * jerárquico (Depósito → Producto → Variante). Lista **todas** las
 * `VarianteSKU` activas de un `ProductoMaestro`, sin filtrar por si ya
 * tienen `StockDeposito` en el depósito elegido — mismo criterio que
 * `listarProductosConVariantes()` en `producto.service.ts`.
 */
export async function listarVariantesPorProducto(
  productoMaestroId: string,
): Promise<VariantePorProducto[]> {
  return prisma.varianteSKU.findMany({
    where: {
      producto_maestro_id: productoMaestroId,
      is_active: true,
    },
    select: {
      id: true,
      talle: true,
      color: true,
      genero: true,
      modelo: true,
      sku: true,
    },
    orderBy: [{ talle: "asc" }, { color: "asc" }],
  });
}
