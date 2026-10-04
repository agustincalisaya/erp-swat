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

/** Filtros mínimos de HU-E1 (los completos — talle/color/género/orden — son de HU-E11). */
export const ListarCatalogoQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoria: z.string().trim().max(100).optional(),
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
