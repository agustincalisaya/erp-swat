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

// ──────────────────────────────────────────────────────────────────────────────
// HU-A3 — Transición a estado «En Prueba» (Cifrado AES-256)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Schema de entrada para registrar la asignación de una unidad de stock al
 * estado EN_PRUEBA y vincularla al efectivo institucional receptor.
 *
 * Los campos `efectivo_placa` y `efectivo_organismo` se cifran en la capa de
 * servicio mediante AES-256-GCM antes de persistir (Ley N.° 25.326).
 *
 * @see src/lib/services/inventario/legajo-prueba.service.ts
 * @see spec_modulo_A_HU3.md §2.1
 */
export const IniciarLegajoPruebaSchema = z.object({
  variante_sku_id: z.string().uuid("El ID de variante SKU debe ser un UUID válido"),
  deposito_origen_id: z.string().uuid("El ID de depósito debe ser un UUID válido"),
  /** Generalmente 1 para pruebas de tallaje unitario */
  cantidad: z.number().int().positive("La cantidad debe ser un número entero positivo").default(1),
  efectivo_placa: z
    .string()
    .min(1, "La placa/credencial es obligatoria")
    .max(50, "La placa no puede superar los 50 caracteres")
    .trim(),
  efectivo_organismo: z
    .string()
    .min(1, "El organismo de pertenencia es obligatorio")
    .max(100, "El organismo no puede superar los 100 caracteres")
    .trim(),
});

export type IniciarLegajoPruebaInput = z.infer<typeof IniciarLegajoPruebaSchema>;

