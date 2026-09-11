import { z } from "zod";

// Ruta relativa con extensión `.ts` explícita (no alias `@/`, no sin extensión)
// a propósito: este schema lo importan como valor tests que corren con
// `node --experimental-strip-types`, que no resuelve paths ni infiere extensión.
import { claveCombinacionVariante } from "../utils/sku.ts";

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
 *
 * `proveedor_por_combinacion` — a diferencia de `ean_por_combinacion` — es
 * OBLIGATORIO y COMPLETO: cada `VarianteSKU` nace con un proveedor habitual
 * (`VarianteSKU.proveedor_id` es NOT NULL) que se elige por fila en la Matriz
 * de Variantes. Misma clave normalizada que `ean_por_combinacion`
 * (`claveCombinacionVariante()`). El `.refine()` exige que TODAS las
 * combinaciones del producto cartesiano `talles × colores × generos` tengan
 * una entrada — no se admite omitir filas. La capa de servicio revalida que
 * cada `proveedor_id` sea de un proveedor activo y HOMOLOGADO.
 */
export const GenerarVariantesMatrizSchema = z
  .object({
    producto_maestro_id: z.string().uuid(),
    modelo: z.string().min(1).max(10),
    talles: z.array(z.string().min(1)).min(1),
    colores: z.array(z.string().min(1)).min(1),
    generos: z.array(z.enum(["HOMBRE", "MUJER", "UNISEX"])).min(1),
    ean_por_combinacion: z
      .record(z.string(), z.string().regex(/^\d{13}$/, "EAN-13 debe tener 13 dígitos"))
      .optional(),
    proveedor_por_combinacion: z.record(
      z.string(),
      z.string().uuid("Debe seleccionar un proveedor habitual"),
    ),
  })
  .refine(
    (data) => {
      for (const talle of data.talles) {
        for (const color of data.colores) {
          for (const genero of data.generos) {
            const clave = claveCombinacionVariante({ talle, color, genero });
            if (!data.proveedor_por_combinacion[clave]) return false;
          }
        }
      }
      return true;
    },
    {
      message:
        "Falta seleccionar el proveedor habitual para al menos una combinación generada",
      path: ["proveedor_por_combinacion"],
    },
  );

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

const CantidadPositivaSchema = z.preprocess(
  (val) => (val === "" || val === undefined || val === null ? undefined : Number(val)),
  z
    .number({
      invalid_type_error: "Este campo es requerido",
      required_error: "Este campo es requerido",
    })
    .int("Debe ser un número entero")
    .positive("La cantidad debe ser mayor a 0"),
);

/** HU-A11 (multi-ítem) — un ítem del carrito de ingreso: variante + cantidad + estado propio. */
export const IngresoItemSchema = z.object({
  variante_sku_id: z.string().uuid("Código no resuelto: variante inválida"),
  cantidad: CantidadPositivaSchema,
  estado_destino: z.enum(ESTADOS_DESTINO_INGRESO),
  /**
   * El modelo de datos actual (`VarianteSKU`) representa un modelo genérico
   * (talle+color+género+modelo), no una unidad serializada individual.
   * Se acepta por compatibilidad con el formulario del escáner pero no se
   * persiste salvo que la variante sea serializada (`numero_serie` migra al
   * ítem cuando corresponde).
   */
  numero_serie: z.string().trim().optional(),
});

/**
 * HU-A11 (multi-ítem) — registro de ingreso en lote: un `deposito_destino_id`
 * y `comprobante_referencia` compartidos por toda la cabecera, con 1+ ítems
 * (cada uno con su propia variante/cantidad/estado, ver `IngresoItemSchema`).
 */
export const RegistrarIngresoPorEscaneoSchema = z.object({
  deposito_destino_id: z.string().uuid("Seleccioná un depósito destino"),
  comprobante_referencia: z
    .string()
    .max(100, "Máximo 100 caracteres")
    .trim()
    .default(""),
  items: z.array(IngresoItemSchema).min(1, "Agregá al menos un ítem al carrito"),
});

export type IngresoItemInput = z.infer<typeof IngresoItemSchema>;
export type RegistrarIngresoPorEscaneoInput = z.infer<
  typeof RegistrarIngresoPorEscaneoSchema
>;

/** HU-A11 (multi-ítem) — un ítem del carrito de transferencia: variante + cantidad. */
export const TransferenciaItemSchema = z.object({
  variante_sku_id: z.string().uuid(),
  cantidad: z.number().int().positive(),
});

// HU-5 — Transferencia interna en dos fases (HU-A11: multi-ítem)
export const CrearTransferenciaSchema = z
  .object({
    deposito_origen_id: z.string().uuid(),
    deposito_destino_id: z.string().uuid(),
    items: z.array(TransferenciaItemSchema).min(1, "Agregá al menos un ítem al carrito"),
  })
  .refine((data) => data.deposito_origen_id !== data.deposito_destino_id, {
    message: "El depósito de origen y destino no pueden ser iguales",
    path: ["deposito_destino_id"],
  });

export const BajaTransferenciaSchema = z.object({
  deletion_reason: z.string().trim().min(1, "El motivo de baja es obligatorio"),
});

export const TransferenciaIdSchema = z.string().uuid("El ID de transferencia es inválido");

/** HU-A11 — recepción (total o parcial) de una `TransferenciaStock`: cuánto se recibió de cada ítem. */
export const ConfirmarRecepcionTransferenciaSchema = z.object({
  transferencia_id: z.string().uuid("El ID de transferencia es inválido"),
  items: z
    .array(
      z.object({
        transferencia_item_id: z.string().uuid(),
        cantidad_recibida: z.number().int().positive(),
      }),
    )
    .min(1, "Marcá al menos un ítem con cantidad a recibir"),
});

export type ConfirmarRecepcionTransferenciaInput = z.infer<
  typeof ConfirmarRecepcionTransferenciaSchema
>;

/** Mismo contrato que `ConfirmarRecepcionTransferenciaSchema` sin `transferencia_id` — para el Route Handler REST, que ya lo recibe en la URL (`/api/inventario/transferencias/[id]/recepcion`). */
export const ConfirmarRecepcionTransferenciaBodySchema = ConfirmarRecepcionTransferenciaSchema.omit({
  transferencia_id: true,
});

/**
 * Exportado (originalmente privado de este módulo) para que
 * `HistorialMovimientosQuerySchema` (HU-A11, sección 2.10) reutilice la misma
 * validación de fecha en vez de duplicar el regex — sin alterar su
 * comportamiento para `FiltrosHistorialTransferenciasSchema`.
 */
export const FechaCalendarioSchema = z
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

// ──────────────────────────────────────────────────────────────────────────────
// HU-A11 — Historial operativo de movimientos (spec_modulo_A.md §2.10)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Query de `GET /api/inventario/movimientos/historial`. `deposito_id` filtra
 * por depósito de origen O destino (ver `listarHistorialMovimientos()`) — un
 * único filtro simple en vez de dos separados, decisión de UX de esta HU.
 *
 * `por_pagina` con tope y default 10 (requisito confirmado de HU-A11, distinto
 * del tope 20 de HU-A5/HU-A6 en este mismo archivo).
 */
export const HistorialMovimientosQuerySchema = z.object({
  deposito_id: z.string().uuid().optional(),
  variante_sku_id: z.string().uuid().optional(),
  tipo_movimiento: z.enum(["INGRESO", "EGRESO", "TRANSFERENCIA", "AJUSTE"]).optional(),
  fecha_desde: z.preprocess((valor) => (valor === "" ? undefined : valor), FechaCalendarioSchema.optional()),
  fecha_hasta: z.preprocess((valor) => (valor === "" ? undefined : valor), FechaCalendarioSchema.optional()),
  busqueda: z.string().trim().optional(),
  pagina: z.coerce.number().int().positive().default(1),
  por_pagina: z.coerce.number().int().positive().max(10).default(10),
});

export type HistorialMovimientosQuery = z.infer<typeof HistorialMovimientosQuerySchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-A8 — Edición de atributos operativos de Producto Maestro y Variante
// spec_modulo_A.md §2.7. El SKU de una VarianteSKU es inmutable: talle, color,
// genero, modelo y sku quedan deliberadamente FUERA de estos schemas — un
// intento de enviarlos es rechazado por `.strict()` con 400, sin necesidad de
// lógica condicional adicional en la capa de servicios.
// ──────────────────────────────────────────────────────────────────────────────

// `codigo_producto` queda deliberadamente fuera de EditarProductoMaestroSchema
// — es el segmento [PRODUCTO] del SKU determinístico de todas las variantes ya
// generadas; editarlo rompería la trazabilidad del SKU contra el código físico
// ya impreso, mismo motivo por el que talle/color/genero/modelo son inmutables
// en Variante.
export const EditarProductoMaestroSchema = z
  .object({
    nombre: z.string().min(1, "El nombre es obligatorio").optional(),
    descripcion: z.string().optional(),
    categoria: z.string().min(1, "La categoría es obligatoria").optional(),
    rubro: z.string().min(1, "El rubro es obligatorio").optional(),
    unidad_medida: z.string().min(1, "La unidad de medida es obligatoria").optional(),
    proveedor_preferente: z.string().optional(),
    costo_estandar_referencia: z
      .number({ invalid_type_error: "El costo debe ser un número" })
      .nonnegative("El costo no puede ser negativo")
      .optional(),
  })
  .strict();

export type EditarProductoMaestroInput = z.infer<typeof EditarProductoMaestroSchema>;

export const EditarVarianteOperativaSchema = z
  .object({
    ean_qr: z
      .string()
      .regex(/^\d{13}$/, "EAN-13 debe tener 13 dígitos")
      .optional(),
    proveedor_id: z.string().uuid().optional(),
  })
  .strict();

export type EditarVarianteOperativaInput = z.infer<typeof EditarVarianteOperativaSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-A9 — Reclasificación de unidades DEVUELTO (spec_modulo_A.md §2.8/§3.8)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reclasificación directa de una unidad en estado `DEVUELTO`
 * (spec_modulo_A.md §2.8). `resultado_control_calidad` decide la transición
 * determinística: `APTO` → `DISPONIBLE` (reincorpora al stock comercial) o
 * `NO_APTO` → `BAJA_MERMA` (baja por rotura/obsolescencia).
 *
 * El `superRefine` de `motivo` es la aplicación explícita de la regla de
 * motivo obligatorio de la sección 3.5 en este flujo — no una
 * reimplementación paralela. El service re-valida con `MOTIVO_REQUERIDO`
 * (defensa en profundidad), mismo contrato que `darDeBajaVariante()`.
 *
 * `rma_id` es una referencia opcional al Módulo I (garantía) — el Módulo A
 * no valida su existencia (aislamiento de dominio, RULES.md Regla N.° 3).
 */
export const ReclasificarDevueltoSchema = z
  .object({
    variante_sku_id: z.string().uuid(),
    deposito_id: z.string().uuid(),
    cantidad: z.number().int().positive(),
    resultado_control_calidad: z.enum(["APTO", "NO_APTO"]),
    motivo: z.string().trim().min(1).optional(),
    rma_id: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.resultado_control_calidad === "NO_APTO" && !data.motivo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "motivo es obligatorio cuando resultado_control_calidad = NO_APTO",
        path: ["motivo"],
      });
    }
  });

export type ReclasificarDevueltoInput = z.infer<typeof ReclasificarDevueltoSchema>;

/**
 * Aprobación de una `ReclasificacionSolicitud` pendiente
 * (spec_modulo_A.md §3.8). Sin body: la solicitud se identifica por el
 * segmento `[id]` de la ruta. `.strict()` rechaza cualquier campo extra.
 */
export const AprobarSolicitudSchema = z.object({}).strict();

/** Rechazo de una `ReclasificacionSolicitud` pendiente — `rechazada_motivo` obligatorio. */
export const RechazarSolicitudSchema = z.object({
  rechazada_motivo: z.string().trim().min(1, "El motivo de rechazo es obligatorio"),
});

export type RechazarSolicitudInput = z.infer<typeof RechazarSolicitudSchema>;

/** Valida el segmento `[id]` de las rutas `reclasificaciones/[id]/aprobar|rechazar`. */
export const SolicitudReclasificacionIdSchema = z.string().uuid("El ID de solicitud es inválido");

/** Filtros mínimos de `GET /api/inventario/devoluciones` (sin paginación). */
export const ListarUnidadesDevueltasQuerySchema = z.object({
  variante_sku_id: z.string().uuid().optional(),
  deposito_id: z.string().uuid().optional(),
});

export type ListarUnidadesDevueltasQuery = z.infer<typeof ListarUnidadesDevueltasQuerySchema>;
