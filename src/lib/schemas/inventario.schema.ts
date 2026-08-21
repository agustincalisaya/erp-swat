import { z } from "zod";

/**
 * Semántica: stock_seguridad (piso crítico) < punto_pedido (umbral de alerta)
 * El refine exige punto_pedido >= stock_seguridad para dejar margen de reacción.
 */
export const ActualizarUmbralesStockSchema = z
  .object({
    variante_sku_id: z.string().uuid(),
    deposito_id: z.string().uuid(),
    punto_pedido: z.preprocess(
      (val) =>
        val === "" || val === undefined || val === null
          ? undefined
          : Number(val),
      z
        .number({
          invalid_type_error: "Este campo es requerido",
          required_error: "Este campo es requerido",
        })
        .int("Debe ser un número entero")
        .min(0, "Debe ser mayor o igual a 0"),
    ),
    stock_seguridad: z.preprocess(
      (val) =>
        val === "" || val === undefined || val === null
          ? undefined
          : Number(val),
      z
        .number({
          invalid_type_error: "Este campo es requerido",
          required_error: "Este campo es requerido",
        })
        .int("Debe ser un número entero")
        .min(0, "Debe ser mayor o igual a 0"),
    ),
  })
  .refine((data) => data.punto_pedido >= data.stock_seguridad, {
    message: "El punto de pedido no puede ser menor al stock de seguridad",
    path: ["punto_pedido"],
  });

export type ActualizarUmbralesStockInput = z.infer<
  typeof ActualizarUmbralesStockSchema
>;

export const CalcularPromedioMovilSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  meses_historico: z.number().int().min(1).max(12).default(3),
});

export type CalcularPromedioMovilInput = z.infer<
  typeof CalcularPromedioMovilSchema
>;

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
  variante_sku_id: z
    .string()
    .uuid("El ID de variante SKU debe ser un UUID válido"),
  deposito_origen_id: z
    .string()
    .uuid("El ID de depósito debe ser un UUID válido"),
  /** Generalmente 1 para pruebas de tallaje unitario */
  cantidad: z
    .number()
    .int()
    .positive("La cantidad debe ser un número entero positivo")
    .default(1),
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

export type IniciarLegajoPruebaInput = z.infer<
  typeof IniciarLegajoPruebaSchema
>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-2 — Escaneo de códigos e ingreso de mercadería
// ──────────────────────────────────────────────────────────────────────────────

export const ResolverCodigoEscaneoSchema = z.object({
  codigo: z.string().min(1, "El código escaneado es obligatorio").trim(),
});

export type ResolverCodigoEscaneoInput = z.infer<
  typeof ResolverCodigoEscaneoSchema
>;

const ESTADOS_DESTINO_INGRESO = [
  "DISPONIBLE",
  "EN_PRUEBA",
  "RESERVADO",
  "VENDIDO",
  "DEVUELTO",
  "BAJA_MERMA",
  "EN_TRANSITO",
] as const;

export const RegistrarIngresoPorEscaneoSchema = z.object({
  variante_sku_id: z.string().uuid("Código no resuelto: variante inválida"),
  deposito_destino_id: z.string().uuid("Seleccioná un depósito destino"),
  cantidad: z.preprocess(
    (val) =>
      val === "" || val === undefined || val === null ? undefined : Number(val),
    z
      .number({
        invalid_type_error: "Este campo es requerido",
        required_error: "Este campo es requerido",
      })
      .int("Debe ser un número entero")
      .positive("La cantidad debe ser mayor a 0"),
  ),
  comprobante_referencia: z
    .string()
    .max(100, "Máximo 100 caracteres")
    .trim()
    .default(""),
  estado_destino: z.enum(ESTADOS_DESTINO_INGRESO),
  /**
   * El modelo de datos actual (`VarianteSKU`) representa un modelo genérico
   * (talle+color+género+modelo), no una unidad serializada individual — ver
   * nota en `legajo-prueba.service.ts`. Estos campos se aceptan por
   * compatibilidad con el formulario del escáner pero no se persisten.
   */
  es_serializado: z.boolean().default(false),
  numero_serie: z.string().trim().optional(),
});

export type RegistrarIngresoPorEscaneoInput = z.infer<
  typeof RegistrarIngresoPorEscaneoSchema
>;
