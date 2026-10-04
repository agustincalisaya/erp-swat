/**
 * Schemas Zod de Módulo E — E-commerce / Tienda Online (spec_modulo_E.md).
 */
import { z } from "zod";

/**
 * HU-E8 §2.8 — login de Cliente Web.
 * TODO(HU-E8): introducido por HU-E1 como parte del mínimo provisional de
 * sesión (`lib/auth/sesion-cliente-web.ts`); el owner de HU-E8 lo completa.
 */
export const IniciarSesionClienteWebSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type IniciarSesionClienteWebInput = z.infer<typeof IniciarSesionClienteWebSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-E1 §2.1 — catálogo y carrito
// ──────────────────────────────────────────────────────────────────────────────

/** Tope por línea de carrito: evita cantidades absurdas en un carrito anónimo
 * (la garantía real anti-sobreventa es la reserva del checkout). */
export const CANTIDAD_MAXIMA_POR_ITEM = 99;

export const AgregarAlCarritoSchema = z.object({
  variante_sku_id: z.string().uuid(),
  cantidad: z.number().int().positive().max(CANTIDAD_MAXIMA_POR_ITEM),
});
export type AgregarAlCarritoInput = z.infer<typeof AgregarAlCarritoSchema>;

export const ActualizarCantidadCarritoSchema = z.object({
  cantidad: z.number().int().positive().max(CANTIDAD_MAXIMA_POR_ITEM),
});
export type ActualizarCantidadCarritoInput = z.infer<typeof ActualizarCantidadCarritoSchema>;

export const ItemCarritoIdSchema = z.string().uuid("El identificador del ítem es inválido");
export const ProductoWebIdSchema = z.string().uuid("El identificador del producto es inválido");

/** HU-E11 (task_relos.md D10, D20) — orden del listado de la tienda. */
export const ORDENES_CATALOGO = ["novedad", "precio_asc", "precio_desc"] as const;
export type OrdenCatalogo = (typeof ORDENES_CATALOGO)[number];

const filtroCatalogo = z.string().trim().max(100).optional();

/**
 * Listado de la tienda. HU-E1 definió `q`, `categoria` y la paginación; HU-E11
 * agrega los filtros de variante y el orden (D10). Un valor inexistente de
 * categoría/talle/color/género/modelo da lista vacía; solo `orden`, `page`,
 * `page_size` o un largo inválido dan 400. Sin `.strict()`: los parámetros
 * extra de la URL se ignoran (D20).
 */
export const ListarCatalogoQuerySchema = z.object({
  q: filtroCatalogo,
  categoria: filtroCatalogo,
  talle: filtroCatalogo,
  color: filtroCatalogo,
  genero: filtroCatalogo,
  modelo: filtroCatalogo,
  orden: z.enum(ORDENES_CATALOGO).default("novedad"),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(48).default(12),
});
export type ListarCatalogoQuery = z.infer<typeof ListarCatalogoQuerySchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-E2 §2.2 — checkout con pago online
// ──────────────────────────────────────────────────────────────────────────────

/**
 * spec_modulo_E.md §2.2. Un único cupón por pedido (HU-E4, no acumulable). El
 * importe NO se acepta del navegador: se calcula siempre en el servidor (CA5);
 * `.strict()` rechaza cualquier campo extra (ej. `total`, `monto`).
 */
export const IniciarCheckoutSchema = z
  .object({
    cupon_codigo: z.string().trim().min(3).max(50).toUpperCase().optional(),
  })
  .strict();
export type IniciarCheckoutInput = z.infer<typeof IniciarCheckoutSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-E5 §2.5 — visibilidad web y baja lógica del contenido (task_relos.md D1)
// ──────────────────────────────────────────────────────────────────────────────

/** Body ausente, `null`, array o no-JSON (`leerJson` lo convierte en `null`). */
const CUERPO_OBJETO = {
  required_error: "El cuerpo debe ser un objeto JSON",
  invalid_type_error: "El cuerpo debe ser un objeto JSON",
};

/** Cualquier campo desconocido (incluido el actor) es 400, mismo criterio que HU-E4. */
const CAMPOS_NO_PERMITIDOS = "El cuerpo contiene campos no permitidos";

/** Ocultar/mostrar en la tienda: UPDATE reversible, motivo opcional (spec §2.5). */
export const CambiarVisibilidadWebSchema = z.object(
  {
    visibilidad_web: z.boolean({
      required_error: "La visibilidad web es obligatoria",
      invalid_type_error: "La visibilidad web debe ser verdadero o falso",
    }),
    motivo: z
      .string({ invalid_type_error: "El motivo debe ser texto" })
      .trim()
      .min(1, "El motivo no puede estar vacío")
      .max(500, "El motivo admite hasta 500 caracteres")
      .optional(),
  },
  CUERPO_OBJETO,
).strict(CAMPOS_NO_PERMITIDOS);
export type CambiarVisibilidadWebInput = z.infer<typeof CambiarVisibilidadWebSchema>;

/** Baja lógica del contenido web (criterio 3): motivo obligatorio. */
export const BajaContenidoWebSchema = z.object(
  {
    deletion_reason: z
      .string({ required_error: "El motivo de baja es obligatorio", invalid_type_error: "El motivo de baja debe ser texto" })
      .trim()
      .min(1, "El motivo de baja es obligatorio")
      .max(500, "El motivo de baja admite hasta 500 caracteres"),
  },
  CUERPO_OBJETO,
).strict(CAMPOS_NO_PERMITIDOS);
export type BajaContenidoWebInput = z.infer<typeof BajaContenidoWebSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-E7 §2.7 — anulación manual de orden web no abonada (task_relos.md D12)
// ──────────────────────────────────────────────────────────────────────────────

/** `[id]` de la ruta = `pedido_venta_id` (UUID de `PedidoVenta`, D1). */
export const PedidoVentaIdSchema = z.string().uuid("El identificador del pedido es inválido");

/** Motivo obligatorio (criterio 3); el actor sale siempre de la sesión. Sin tope de largo (decisión de Adriel). */
export const AnularOrdenNoAbonadaSchema = z.object(
  {
    deletion_reason: z
      .string({
        required_error: "El motivo de anulación es obligatorio",
        invalid_type_error: "El motivo de anulación debe ser texto",
      })
      .trim()
      .min(1, "El motivo de anulación es obligatorio"),
  },
  CUERPO_OBJETO,
).strict(CAMPOS_NO_PERMITIDOS);
export type AnularOrdenNoAbonadaInput = z.infer<typeof AnularOrdenNoAbonadaSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// HU-E11 §2.11 — contenido comercial y fotos del catálogo (task_relos.md §2)
// ──────────────────────────────────────────────────────────────────────────────

export const FotoWebIdSchema = z.string().uuid("El identificador de la foto es inválido");

export const CrearContenidoWebSchema = z.object(
  {
    producto_maestro_id: z
      .string({ required_error: "El producto maestro es obligatorio", invalid_type_error: "El producto maestro es inválido" })
      .uuid("El identificador del producto maestro es inválido"),
    titulo_comercial: z
      .string({ required_error: "El título comercial es obligatorio", invalid_type_error: "El título comercial debe ser texto" })
      .trim()
      .min(1, "El título comercial es obligatorio"),
    descripcion: z
      .string({ required_error: "La descripción es obligatoria", invalid_type_error: "La descripción debe ser texto" })
      .trim()
      .min(1, "La descripción es obligatoria"),
  },
  CUERPO_OBJETO,
).strict(CAMPOS_NO_PERMITIDOS);
export type CrearContenidoWebInput = z.infer<typeof CrearContenidoWebSchema>;

/** Solo título y/o descripción (al menos uno); nunca visibilidad, producto ni baja (D5). */
export const EditarContenidoWebSchema = z
  .object(
    {
      titulo_comercial: z
        .string({ invalid_type_error: "El título comercial debe ser texto" })
        .trim()
        .min(1, "El título comercial no puede estar vacío")
        .optional(),
      descripcion: z
        .string({ invalid_type_error: "La descripción debe ser texto" })
        .trim()
        .min(1, "La descripción no puede estar vacía")
        .optional(),
    },
    CUERPO_OBJETO,
  )
  .strict(CAMPOS_NO_PERMITIDOS)
  .refine((v) => v.titulo_comercial !== undefined || v.descripcion !== undefined, {
    message: "Debe indicar al menos un campo a modificar",
  });
export type EditarContenidoWebInput = z.infer<typeof EditarContenidoWebSchema>;

/**
 * Contrato de la spec §2.11: valida el resultado YA resuelto por el Gateway
 * (D2), no lo que manda el cliente. Desvío documentado (D19, Revisión 6):
 * además de una URL absoluta acepta una ruta que empieza con `/` (el Adapter
 * local guarda `/api/tienda/fotos/<uuid>.<ext>`).
 */
export const SubirFotoProductoSchema = z.object({
  url: z.union([z.string().url(), z.string().regex(/^\/(?!\/)\S+$/, "La URL de la foto es inválida")]),
  es_principal: z.boolean().default(false),
});
export type SubirFotoProductoInput = z.infer<typeof SubirFotoProductoSchema>;

/** Campo `es_principal` del multipart: solo los textos "true" / "false" (ausente = false). */
export const EsPrincipalMultipartSchema = z
  .enum(["true", "false"], { errorMap: () => ({ message: "es_principal debe ser \"true\" o \"false\"" }) })
  .optional()
  .transform((v) => v === "true");

/**
 * PATCH de una foto (D7): exactamente una operación — `{ es_principal: true }`
 * o `{ deletion_reason }`. Equivale al `z.union` de dos objetos estrictos del
 * task §2, escrito como objeto estricto + `superRefine` para que cada error
 * salga en español y en su campo.
 */
export const ActualizarFotoWebSchema = z
  .object(
    {
      es_principal: z
        .literal(true, { errorMap: () => ({ message: "es_principal solo admite el valor true" }) })
        .optional(),
      deletion_reason: z
        .string({ invalid_type_error: "El motivo de baja debe ser texto" })
        .trim()
        .min(1, "El motivo de baja es obligatorio")
        .optional(),
    },
    CUERPO_OBJETO,
  )
  .strict(CAMPOS_NO_PERMITIDOS)
  .superRefine((v, ctx) => {
    const operaciones = Number(v.es_principal !== undefined) + Number(v.deletion_reason !== undefined);
    if (operaciones !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Indicá exactamente una operación: marcar como principal o dar de baja con motivo",
      });
    }
  });
export type ActualizarFotoWebInput = z.infer<typeof ActualizarFotoWebSchema>;

/**
 * Campos del multipart de `POST …/fotos` (task §1): `archivo` (un único File)
 * y `es_principal` opcional. Cualquier otro campo, o `archivo` repetido o de
 * texto, es 400 (mismo criterio que `.strict()` en los bodies JSON, D16).
 */
export const SubirFotoMultipartSchema = z
  .object(
    {
      archivo: z.instanceof(File, { message: "El archivo es obligatorio" }),
      es_principal: EsPrincipalMultipartSchema,
    },
    CUERPO_OBJETO,
  )
  .strict(CAMPOS_NO_PERMITIDOS);
