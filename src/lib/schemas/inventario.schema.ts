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
  /**
   * Ajuste post-HU-A1: se sacó del formulario de alta (decisión de
   * negocio — la columna sigue existiendo y sigue siendo NOT NULL en la
   * base). Opcional acá, con default "UNIDAD" resuelto en
   * `crearProductoMaestro()` — un consumidor directo del API (Postman,
   * otro cliente) todavía puede mandarlo explícito.
   */
  unidad_medida: z.string().min(1).optional(),
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
 *  - RESTA — `RESERVADO`, `VENDIDO` y `BAJA_MERMA`: mercadería que queda
 *    inmediatamente comprometida/no vendible y se descuenta del disponible
 *    del depósito seleccionado.
 * `Record` exhaustivo a propósito: agregar un estado nuevo al enum rompe la
 * compilación hasta decidir explícitamente su impacto acá.
 */
export const IMPACTO_STOCK_POR_ESTADO_DESTINO: Record<IngresoEstadoDestino, ImpactoStockDestino> = {
  DISPONIBLE: "SUMA",
  DEVUELTO: "SUMA",
  RESERVADO: "RESTA",
  VENDIDO: "RESTA",
  BAJA_MERMA: "RESTA",
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

const FechaCalendarioSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato AAAA-MM-DD")
  .refine((valor) => {
    const [year, month, day] = valor.split("-").map(Number);
    const fecha = new Date(Date.UTC(year, month - 1, day));
    return fecha.getUTCFullYear() === year && fecha.getUTCMonth() === month - 1 && fecha.getUTCDate() === day;
  }, "La fecha no es válida");

export const FiltrosHistorialTransferenciasSchema = z
  .object({
    remito: z.string().trim().max(120, "El remito no puede superar los 120 caracteres").default(""),
    desde: z.preprocess((valor) => valor === "" ? undefined : valor, FechaCalendarioSchema.optional()),
    hasta: z.preprocess((valor) => valor === "" ? undefined : valor, FechaCalendarioSchema.optional()),
    page: z.coerce.number().int().min(1).default(1),
  })
  .refine((data) => !data.desde || !data.hasta || data.desde <= data.hasta, {
    message: "La fecha Desde no puede ser posterior a Hasta",
    path: ["desde"],
  });

export type CrearTransferenciaInput = z.infer<typeof CrearTransferenciaSchema>;
export type BajaTransferenciaInput = z.infer<typeof BajaTransferenciaSchema>;
export type FiltrosHistorialTransferenciasInput = z.infer<typeof FiltrosHistorialTransferenciasSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-A10 — Servicio centralizado de Reserva (congelamiento y liberación)
// spec_modulo_A.md §2.9. Backend puro, sin UI: consumido internamente por
// Módulo B (HU-B3, cotización institucional) y Módulo E (HU-E1, checkout web)
// a futuro — ninguno de los dos implementa lógica de reserva propia.
// ──────────────────────────────────────────────────────────────────────────────

/** Los 3 orígenes válidos de una Reserva (enum `OrigenReserva` en schema.prisma). */
export const ORIGENES_RESERVA = ["SENIA", "LICITACION", "PEDIDO_INSTITUCIONAL"] as const;

/**
 * Congelamiento de stock (spec §2.9). `ttl_horas` es opcional: si se omite,
 * la capa de servicios resuelve el default por `origen_reserva` (72h para los
 * 3 orígenes generales). El canal e-commerce SIEMPRE provee `ttl_horas`
 * explícito y acotado (< 72h) — nunca depende del default.
 */
export const CrearReservaSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_id: z.string().uuid(),
  cantidad: z.number().int().positive(),
  origen_reserva: z.enum(ORIGENES_RESERVA),
  motivo: z.string().optional(),
  ttl_horas: z.number().int().positive().optional(),
});

export type CrearReservaInput = z.infer<typeof CrearReservaSchema>;

/** Liberación por venta confirmada (spec §2.9). `venta_id` es la referencia
 * externa del Módulo B/E que originó la confirmación. */
export const ConfirmarReservaSchema = z.object({
  venta_id: z.string().uuid(),
});

export type ConfirmarReservaInput = z.infer<typeof ConfirmarReservaSchema>;

export const ReservaIdSchema = z.string().uuid("El ID de reserva es inválido");

// ──────────────────────────────────────────────────────────────────────────────
// HU-A6 Ajustes — UI de Variantes (listado paginado + reporte inactivo)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Filtros del listado paginado de `VarianteSKU` (vista Variantes, HU-A6).
 * Shape-only y aditivo: NO toca `BajaLogicaVarianteSchema` (criterio 8 — el
 * backend de baja aprobado queda byte-idéntico).
 *
 * `tab` define la vista (Activas por defecto / Inactivas, solo lectura);
 * `q` es la búsqueda general (parcial, case-insensitive) y
 * `producto_maestro_id` el filtro por Producto Maestro (por nombre, nunca
 * por SKU); ambos aplican sobre la pestaña activa. `page` es 1-based y se
 * resetea al buscar o filtrar (el cliente borra el param antes de navegar).
 */
export const ListarVariantesSchema = z.object({
  tab: z.enum(["activas", "inactivas"]).default("activas"),
  q: z.string().max(200).optional(),
  producto_maestro_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type ListarVariantesInput = z.infer<typeof ListarVariantesSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-A5 ampliada (Sprint 2) — Consola de Depósito: listado paginado de
// "productos por depósito" con buscador de texto libre (spec_modulo_A.md §2.6 /
// task_HU-A5-ampliacion.md §2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Query de `GET /api/inventario/depositos/[id]/productos`.
 *
 * `deposito_id` NO llega como search param: el Route Handler lo compone a
 * partir del segmento `[id]` de la URL antes del `safeParse`. `por_pagina`
 * tiene tope duro 20 (regla de negocio de spec §2.6: la tabla no admite más
 * de 20 artículos por vista); el `.max(20)` lo impone acá para que ningún
 * camino de código pueda superarlo.
 */
export const ListarProductosPorDepositoQuerySchema = z.object({
  deposito_id: z.string().uuid(),
  busqueda: z.string().trim().optional(),
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(20).default(20),
});

export type ListarProductosPorDepositoQuery = z.infer<
  typeof ListarProductosPorDepositoQuerySchema
>;
