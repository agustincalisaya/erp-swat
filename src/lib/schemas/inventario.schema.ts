import { z } from "zod";

/**
 * Semántica: stock_seguridad (piso crítico) < punto_pedido (umbral de alerta)
 * El refine exige punto_pedido >= stock_seguridad para dejar margen de reacción.
 */
export const ActualizarUmbralesStockSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  punto_pedido: z.number().int().min(0),
  stock_seguridad: z.number().int().min(0),
}).refine(data => data.punto_pedido >= data.stock_seguridad, {
  message: "El punto de pedido no puede ser menor al stock de seguridad",
  path: ["punto_pedido"],
});

export type ActualizarUmbralesStockInput = z.infer<typeof ActualizarUmbralesStockSchema>;

export const CalcularPromedioMovilSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  meses_historico: z.number().int().min(1).max(12).default(3),
});

export type CalcularPromedioMovilInput = z.infer<typeof CalcularPromedioMovilSchema>;
