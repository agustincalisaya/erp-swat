import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────────
// HU-A1 — Alta de Producto Maestro y generación en lote de Variantes SKU
// ──────────────────────────────────────────────────────────────────────────────

export const CrearProductoMaestroSchema = z.object({
  /**
   * Código corto, segmento [PRODUCTO] del SKU (ver `generarSku()` en
   * `lib/utils/sku.ts`). No es único: dos ProductoMaestro de la misma
   * familia pueden compartir código — la unicidad la garantiza VarianteSKU.sku.
   * Solo letras y números, sin espacios ni guiones.
   */
  codigo_producto: z
    .string()
    .min(2, "El código debe tener al menos 2 caracteres")
    .max(8, "El código no puede superar los 8 caracteres")
    .regex(/^[A-Za-z0-9]+$/, "Solo letras y números, sin espacios ni guiones"),
  nombre: z.string().min(1, "El nombre es obligatorio"),
  descripcion: z.string().optional(),
  rubro: z.string().min(1, "El rubro es obligatorio"),
  categoria: z.string().min(1, "La categoría es obligatoria"),
  unidad_medida: z.string().min(1, "La unidad de medida es obligatoria"),
  proveedor_preferente: z.string().optional(),
  costo_estandar_referencia: z
    .number({
      invalid_type_error: "El costo debe ser un número",
      required_error: "El costo estándar es obligatorio",
    })
    .nonnegative("El costo no puede ser negativo"),
});

export type CrearProductoMaestroInput = z.infer<typeof CrearProductoMaestroSchema>;

/**
 * Genera variantes en lote mediante producto cartesiano talle × color × género.
 * "modelo" es el segmento [MODELO] del SKU (ej. "SS3" para Softshell Nivel III).
 *
 * `ean_qr` sigue sin recibirse por variante individual — el default es
 * `NULL` (`VarianteSKU.ean_qr` es nullable justamente para este caso, no se
 * inventa ningún valor). `ean_por_combinacion` es un override opcional y
 * aditivo: mapa `"TALLE|COLOR|GENERO"` (normalizado, ver
 * `claveCombinacionVariante()`) → EAN-13 real, para las combinaciones donde
 * el usuario escaneó/tipeó el código de fábrica de la unidad física antes de
 * confirmar el lote (HU-A1, rediseño del escaneo por variante). Un cliente
 * que no manda este campo obtiene el mismo comportamiento de siempre.
 */
export const GenerarVariantesMatrizSchema = z.object({
  producto_maestro_id: z.string().uuid(),
  modelo: z.string().min(1).max(10),
  talles: z.array(z.string().min(1)).min(1),
  colores: z.array(z.string().min(1)).min(1),
  generos: z.array(z.enum(["HOMBRE", "MUJER", "UNISEX"])).min(1),
  ean_por_combinacion: z
    .record(z.string(), z.string().regex(/^\d{13}$/, "EAN-13 debe tener 13 dígitos"))
    .optional(),
});

export type GenerarVariantesMatrizInput = z.infer<typeof GenerarVariantesMatrizSchema>;

/**
 * Baja lógica de un `ProductoMaestro` (sección 5.3). `deletion_reason` es
 * opcional a nivel de forma — la obligatoriedad depende de si el producto
 * tiene stock remanente en algún depósito, y esa regla se evalúa en la capa
 * de servicio (`desactivarProductoMaestro()`), no acá.
 */
export const DesactivarProductoMaestroSchema = z.object({
  deletion_reason: z.string().trim().min(1).optional(),
});

export type DesactivarProductoMaestroInput = z.infer<typeof DesactivarProductoMaestroSchema>;

/**
 * HU-A6 — Baja lógica de una `VarianteSKU` (sección 3.5 de spec_modulo_A.md).
 * Shape-only, mismo criterio que `DesactivarProductoMaestroSchema`:
 * `deletion_reason` es opcional a nivel de forma — la obligatoriedad depende
 * del stock remanente activo de la variante (`StockDeposito.cantidad > 0`),
 * regla que evalúa la capa de servicio (`darDeBajaVariante()`), no el schema.
 * Sin superRefine (decisión D4).
 */
export const BajaLogicaVarianteSchema = z.object({
  deletion_reason: z.string().trim().min(1).optional(),
});

export type BajaLogicaVarianteInput = z.infer<typeof BajaLogicaVarianteSchema>;

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
  "RESERVADO",
  "VENDIDO",
  "DEVUELTO",
  "BAJA_MERMA",
] as const;

export type IngresoEstadoDestino = (typeof ESTADOS_DESTINO_INGRESO)[number];

export type ImpactoStockDestino = "SUMA" | "RESTA";

/**
 * Impacto de cada `estado_destino` sobre el stock DISPONIBLE/vendible del
 * depósito (`StockDeposito.cantidad` — mismo criterio ya usado por
 * `Reserva`, ver schema.prisma):
 *  - SUMA — `DISPONIBLE` (ingreso estándar) y `DEVUELTO` (reingreso ya
 *    validado como apto para reventa por quien lo selecciona: el modelo
 *    actual no tiene un flag separado de "inspección favorable").
 *  - RESTA — `RESERVADO`, `VENDIDO`, `BAJA_MERMA` y `EN_TRANSITO`: mercadería
 *    que, aunque pasa por esta pantalla de ingreso, queda inmediatamente
 *    comprometida/no vendible y se descuenta del disponible del mismo
 *    depósito seleccionado (este flujo es de un solo depósito — no modela
 *    origen/destino separados para `EN_TRANSITO`).
 * `Record` exhaustivo a propósito: agregar un estado nuevo al enum rompe la
 * compilación hasta decidir explícitamente su impacto acá.
 */
export const IMPACTO_STOCK_POR_ESTADO_DESTINO: Record<IngresoEstadoDestino, ImpactoStockDestino> = {
  DISPONIBLE: "SUMA",
  DEVUELTO: "SUMA",
  RESERVADO: "RESTA",
  VENDIDO: "RESTA",
  BAJA_MERMA: "RESTA",
  EN_TRANSITO: "RESTA",
};

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
   * (talle+color+género+modelo), no una unidad serializada individual.
   * Estos campos se aceptan por compatibilidad con el formulario del
   * escáner pero no se persisten.
   */
  es_serializado: z.boolean().default(false),
  numero_serie: z.string().trim().optional(),
});

export type RegistrarIngresoPorEscaneoInput = z.infer<
  typeof RegistrarIngresoPorEscaneoSchema
>;

// HU-5 — Transferencia interna en dos fases
export const CrearTransferenciaSchema = z
  .object({
    variante_sku_id: z.string().uuid(),
    deposito_origen_id: z.string().uuid(),
    deposito_destino_id: z.string().uuid(),
    cantidad: z.number().int().positive(),
  })
  .refine((data) => data.deposito_origen_id !== data.deposito_destino_id, {
    message: "El depósito de origen y destino no pueden ser iguales",
    path: ["deposito_destino_id"],
  });

export const BajaTransferenciaSchema = z.object({
  deletion_reason: z.string().trim().min(1, "El motivo de baja es obligatorio"),
});

export const TransferenciaIdSchema = z.string().uuid("El ID de transferencia es inválido");

export type CrearTransferenciaInput = z.infer<typeof CrearTransferenciaSchema>;
export type BajaTransferenciaInput = z.infer<typeof BajaTransferenciaSchema>;
